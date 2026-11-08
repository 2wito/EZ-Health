#pragma once

// Read-only memory mapping of a whole file (mmap on POSIX, MapViewOfFile on
// Windows). Used by the CLI; the WebAssembly build feeds chunks instead.

#include <cstddef>
#include <string>
#include <string_view>

namespace ezt {

class MappedFile {
 public:
  /// Throws std::system_error when the file can't be opened or mapped.
  explicit MappedFile(const std::string& path);
  ~MappedFile();

  MappedFile(const MappedFile&) = delete;
  MappedFile& operator=(const MappedFile&) = delete;

  [[nodiscard]] std::string_view view() const noexcept { return {data_, size_}; }
  [[nodiscard]] std::size_t size() const noexcept { return size_; }

  /// Tells the OS the pages before `offset` won't be needed again (POSIX only;
  /// a no-op elsewhere). They're re-read from disk if something touches them.
  void release_before(std::size_t offset) noexcept;

 private:
  const char* data_ = nullptr;
  std::size_t size_ = 0;
};

}  // namespace ezt
