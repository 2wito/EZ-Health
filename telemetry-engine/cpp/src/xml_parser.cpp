#include "xml_parser.hpp"

#include <array>
#include <charconv>
#include <cstring>
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

// ─── Element ────────────────────────────────────────────────────────────────

std::string_view Element::attr(std::string_view key) const noexcept {
  for (const Attribute& a : attributes) {
    if (a.name == key) return a.value;
  }
  return {};
}

bool Element::has(std::string_view key) const noexcept {
  for (const Attribute& a : attributes) {
    if (a.name == key) return true;
  }
  return false;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

namespace {

constexpr bool is_space(char c) noexcept { return c == ' ' || c == '\n' || c == '\r' || c == '\t'; }

const char* find_char(const char* p, const char* end, char c) noexcept {
  return p < end ? static_cast<const char*>(std::memchr(p, c, static_cast<std::size_t>(end - p))) : nullptr;
}

/// Position just past `terminator`, or nullptr when it never appears.
const char* skip_past(const char* p, const char* end, std::string_view terminator) noexcept {
  const std::string_view rest(p, static_cast<std::size_t>(end - p));
  const std::size_t at = rest.find(terminator);
  return at == std::string_view::npos ? nullptr : p + at + terminator.size();
}

bool starts_with(const char* p, const char* end, std::string_view prefix) noexcept {
  return static_cast<std::size_t>(end - p) >= prefix.size() && std::memcmp(p, prefix.data(), prefix.size()) == 0;
}

/// p points at the '!' of "<!...". Returns the position after the construct, or nullptr.
const char* skip_declaration(const char* p, const char* end) noexcept {
  if (starts_with(p, end, "!--")) return skip_past(p + 3, end, "-->");
  if (starts_with(p, end, "![CDATA[")) return skip_past(p + 8, end, "]]>");

  // <!DOCTYPE ...> with an optional [internal subset] that contains '>' itself.
  int depth = 0;
  for (const char* q = p + 1; q < end; ++q) {
    const char c = *q;
    if (c == '"' || c == '\'') {
      q = find_char(q + 1, end, c);
      if (q == nullptr) return nullptr;
    } else if (c == '<' && starts_with(q, end, "<!--")) {
      q = skip_past(q + 4, end, "-->");
      if (q == nullptr) return nullptr;
      --q;  // the loop's ++q lands just past the comment
    } else if (c == '[') {
      ++depth;
    } else if (c == ']') {
      --depth;
    } else if (c == '>' && depth <= 0) {
      return q + 1;
    }
  }
  return nullptr;
}

std::string_view trim(std::string_view s) noexcept {
  while (!s.empty() && is_space(s.front())) s.remove_prefix(1);
  while (!s.empty() && is_space(s.back())) s.remove_suffix(1);
  return s;
}

}  // namespace

XmlStreamParser::XmlStreamParser(ParseOptions options) : options_(std::move(options)) {}

ParseStats XmlStreamParser::parse(std::string_view document, XmlHandler& handler) {
  ParseStats stats;
  stats.bytes = document.size();

  const char* const begin = document.data();
  const char* const end = begin + document.size();
  const char* p = begin;
  std::array<Attribute, kMaxAttributes> attrs{};
  std::size_t next_progress = options_.progress_interval;

  // Counts a malformed construct; false once there have been too many.
  auto fail = [&]() {
    if (++stats.errors > options_.max_errors) {
      stats.aborted = true;
      return false;
    }
    return true;
  };

  while (p < end) {
    const char* lt = find_char(p, end, '<');
    if (lt == nullptr) break;
    p = lt + 1;
    if (p >= end) {
      fail();
      break;
    }

    if (options_.on_progress && static_cast<std::size_t>(p - begin) >= next_progress) {
      options_.on_progress(static_cast<std::size_t>(p - begin));
      next_progress += options_.progress_interval;
    }

    const char c = *p;
    if (c == '?' || c == '!') {
      const char* after = c == '?' ? skip_past(p + 1, end, "?>") : skip_declaration(p, end);
      if (after == nullptr) {
        fail();
        break;
      }
      p = after;
      continue;
    }

    if (c == '/') {
      const char* gt = find_char(p + 1, end, '>');
      if (gt == nullptr) {
        fail();
        break;
      }
      handler.on_close(trim(std::string_view(p + 1, static_cast<std::size_t>(gt - p - 1))));
      p = gt + 1;
      continue;
    }

    // Opening tag: name, then name="value" pairs, then '>' or '/>'.
    const char* q = p;
    while (q < end && !is_space(*q) && *q != '>' && *q != '/') ++q;
    const std::string_view name(p, static_cast<std::size_t>(q - p));

    std::size_t count = 0;
    bool self_closing = false;
    bool ok = !name.empty();
    while (ok) {
      while (q < end && is_space(*q)) ++q;
      if (q >= end) {
        ok = false;
        break;
      }
      if (*q == '>') {
        ++q;
        break;
      }
      if (*q == '/') {
        if (q + 1 < end && q[1] == '>') {
          self_closing = true;
          q += 2;
        } else {
          ok = false;
        }
        break;
      }

      const char* attr_begin = q;
      while (q < end && *q != '=' && !is_space(*q) && *q != '>' && *q != '/') ++q;
      const std::string_view attr_name(attr_begin, static_cast<std::size_t>(q - attr_begin));
      while (q < end && is_space(*q)) ++q;
      if (attr_name.empty() || q >= end || *q != '=') {
        ok = false;
        break;
      }
      ++q;
      while (q < end && is_space(*q)) ++q;
      if (q >= end || (*q != '"' && *q != '\'')) {
        ok = false;
        break;
      }
      const char quote = *q++;
      const char* close = find_char(q, end, quote);
      if (close == nullptr) {
        ok = false;
        break;
      }
      if (count < kMaxAttributes) {
        attrs[count++] = Attribute{attr_name, std::string_view(q, static_cast<std::size_t>(close - q))};
      } else if (!fail()) {
        return stats;
      }
      q = close + 1;
    }

    if (!ok) {
      if (!fail()) return stats;
      // Resynchronise on the end of this tag.
      const char* gt = find_char(q < end ? q : end, end, '>');
      p = gt == nullptr ? end : gt + 1;
      continue;
    }

    ++stats.elements;
    handler.on_open(Element{name, std::span<const Attribute>(attrs.data(), count)});
    if (self_closing) handler.on_close(name);
    p = q;
  }
  return stats;
}

// ─── Entities ───────────────────────────────────────────────────────────────

namespace {

void append_utf8(std::string& out, char32_t cp) {
  if (cp < 0x80) {
    out += static_cast<char>(cp);
  } else if (cp < 0x800) {
    out += static_cast<char>(0xC0 | (cp >> 6));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  } else if (cp < 0x10000) {
    out += static_cast<char>(0xE0 | (cp >> 12));
    out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  } else {
    out += static_cast<char>(0xF0 | (cp >> 18));
    out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
    out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  }
}

}  // namespace

std::string decode_entities(std::string_view raw) {
  if (raw.find('&') == std::string_view::npos) return std::string(raw);

  std::string out;
  out.reserve(raw.size());
  std::size_t i = 0;
  while (i < raw.size()) {
    const std::size_t amp = raw.find('&', i);
    if (amp == std::string_view::npos) {
      out.append(raw.substr(i));
      break;
    }
    out.append(raw.substr(i, amp - i));
    const std::size_t semi = raw.find(';', amp);
    if (semi == std::string_view::npos || semi - amp > 10) {
      out += '&';
      i = amp + 1;
      continue;
    }

    const std::string_view entity = raw.substr(amp + 1, semi - amp - 1);
    bool decoded = true;
    if (entity == "amp") {
      out += '&';
    } else if (entity == "lt") {
      out += '<';
    } else if (entity == "gt") {
      out += '>';
    } else if (entity == "quot") {
      out += '"';
    } else if (entity == "apos") {
      out += '\'';
    } else if (entity.size() > 1 && entity[0] == '#') {
      const bool hex = entity[1] == 'x' || entity[1] == 'X';
      const std::string_view digits = entity.substr(hex ? 2 : 1);
      std::uint32_t cp = 0;
      const auto [ptr, ec] = std::from_chars(digits.data(), digits.data() + digits.size(), cp, hex ? 16 : 10);
      decoded = ec == std::errc{} && ptr == digits.data() + digits.size() && !digits.empty() && cp <= 0x10FFFF;
      if (decoded) append_utf8(out, static_cast<char32_t>(cp));
    } else {
      decoded = false;
    }

    if (decoded) {
      i = semi + 1;
    } else {
      out += '&';
      i = amp + 1;
    }
  }
  return out;
}

// ─── MappedFile ─────────────────────────────────────────────────────────────

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
