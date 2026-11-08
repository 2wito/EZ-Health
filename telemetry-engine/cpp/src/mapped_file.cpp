#include "mapped_file.hpp"

#include <cerrno>
#include <system_error>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <filesystem>
#else
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace ezt {

#ifdef _WIN32

MappedFile::MappedFile(const std::string& path) {
  const std::filesystem::path fs_path(std::u8string(reinterpret_cast<const char8_t*>(path.data()), path.size()));
  HANDLE file = CreateFileW(fs_path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                            FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    throw std::system_error(static_cast<int>(GetLastError()), std::system_category(), "open " + path);
  }
  LARGE_INTEGER size{};
  if (!GetFileSizeEx(file, &size)) {
    const auto err = static_cast<int>(GetLastError());
    CloseHandle(file);
    throw std::system_error(err, std::system_category(), "stat " + path);
  }
  if (size.QuadPart == 0) {
    CloseHandle(file);
    return;
  }
  HANDLE mapping = CreateFileMappingW(file, nullptr, PAGE_READONLY, 0, 0, nullptr);
  CloseHandle(file);
  if (mapping == nullptr) {
    throw std::system_error(static_cast<int>(GetLastError()), std::system_category(), "map " + path);
  }
  void* view = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0);
  const auto err = static_cast<int>(GetLastError());
  CloseHandle(mapping);
  if (view == nullptr) throw std::system_error(err, std::system_category(), "map " + path);
  data_ = static_cast<const char*>(view);
  size_ = static_cast<std::size_t>(size.QuadPart);
}

MappedFile::~MappedFile() {
  if (data_ != nullptr) UnmapViewOfFile(data_);
}

void MappedFile::release_before(std::size_t) noexcept {}

#else

MappedFile::MappedFile(const std::string& path) {
  const int fd = ::open(path.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd < 0) throw std::system_error(errno, std::generic_category(), "open " + path);

  struct stat st{};
  if (::fstat(fd, &st) != 0) {
    const int err = errno;
    ::close(fd);
    throw std::system_error(err, std::generic_category(), "stat " + path);
  }
  if (!S_ISREG(st.st_mode)) {
    ::close(fd);
    throw std::system_error(EINVAL, std::generic_category(), path + " is not a regular file");
  }
  if (st.st_size == 0) {
    ::close(fd);
    return;
  }

  const auto size = static_cast<std::size_t>(st.st_size);
  void* mapped = ::mmap(nullptr, size, PROT_READ, MAP_PRIVATE, fd, 0);
  const int err = errno;
  ::close(fd);  // the mapping keeps the file referenced
  if (mapped == MAP_FAILED) throw std::system_error(err, std::generic_category(), "mmap " + path);

  ::madvise(mapped, size, MADV_SEQUENTIAL);
  data_ = static_cast<const char*>(mapped);
  size_ = size;
}

MappedFile::~MappedFile() {
  if (data_ != nullptr) ::munmap(const_cast<char*>(data_), size_);
}

void MappedFile::release_before(std::size_t offset) noexcept {
  if (data_ == nullptr) return;
  const auto page = static_cast<std::size_t>(::sysconf(_SC_PAGESIZE));
  const std::size_t length = (offset < size_ ? offset : size_) / page * page;
  if (length > 0) ::madvise(const_cast<char*>(data_), length, MADV_DONTNEED);
}

#endif

}  // namespace ezt
