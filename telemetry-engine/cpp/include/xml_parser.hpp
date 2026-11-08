#pragma once

// Zero-copy streaming XML parser for Apple Health export.xml.
//
// The file is memory-mapped and scanned once, front to back. Element names and
// attribute values are std::string_views into the mapping: nothing is copied
// and no DOM is built. The handler sees each element as it is read and keeps
// only what it needs. Pages already parsed can be dropped from memory through
// ParseOptions::on_progress + MappedFile::release_before, so resident memory
// stays flat even for multi-GB exports.
//
// Scope: the subset of XML that Health exports use. Elements and quoted
// attributes are parsed; the DOCTYPE (including its internal subset), comments,
// processing instructions and CDATA are skipped; text content is ignored.
// Attribute values are handed over raw. Call decode_entities() on the few
// values that can contain entities (names), not on numbers and dates.

#include <cstddef>
#include <cstdint>
#include <functional>
#include <span>
#include <string>
#include <string_view>

namespace ezt {

struct Attribute {
  std::string_view name;
  std::string_view value;  // raw, entities not decoded
};

struct Element {
  std::string_view name;
  std::span<const Attribute> attributes;

  /// Value of the attribute, or an empty view when it's missing.
  [[nodiscard]] std::string_view attr(std::string_view key) const noexcept;
  [[nodiscard]] bool has(std::string_view key) const noexcept;
};

/// Receives elements in document order. Views are valid for the life of the
/// mapped document, not only during the callback.
class XmlHandler {
 public:
  virtual ~XmlHandler() = default;
  virtual void on_open(const Element& element) = 0;
  virtual void on_close(std::string_view name) = 0;
};

struct ParseOptions {
  /// Malformed constructs tolerated before giving up (real exports have a few).
  std::uint64_t max_errors = 10'000;
  /// Bytes between on_progress calls.
  std::size_t progress_interval = std::size_t{64} << 20;
  /// Called with the offset parsed so far.
  std::function<void(std::size_t offset)> on_progress;
};

struct ParseStats {
  std::uint64_t bytes = 0;
  std::uint64_t elements = 0;
  std::uint64_t errors = 0;
  bool aborted = false;  // more than max_errors
};

class XmlStreamParser {
 public:
  static constexpr std::size_t kMaxAttributes = 32;

  explicit XmlStreamParser(ParseOptions options = {});
  ParseStats parse(std::string_view document, XmlHandler& handler);

 private:
  ParseOptions options_;
};

/// Read-only memory mapping of a whole file (mmap on POSIX, MapViewOfFile on Windows).
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

/// Decodes the five predefined entities and numeric character references (as UTF-8).
/// Unknown entities are left as written.
[[nodiscard]] std::string decode_entities(std::string_view raw);

}  // namespace ezt
