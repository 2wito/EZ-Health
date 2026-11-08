#pragma once

// Zero-copy streaming XML parser for Apple Health export.xml.
//
// Two ways in:
//   - XmlStreamParser::parse(document): one pass over a complete document,
//     typically a memory-mapped file (see mapped_file.hpp).
//   - IncrementalXmlParser::feed(chunk): the same scanner over a stream of
//     chunks, for when the bytes arrive piece by piece (the browser build).
//     A tag cut off at the end of a chunk is carried over to the next one.
//
// Element names and attribute values are std::string_views into the input:
// nothing is copied and no DOM is built. The handler sees each element as it
// is read and copies whatever it wants to keep. Views are only valid during
// the callback.
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

/// Receives elements in document order.
class XmlHandler {
 public:
  virtual ~XmlHandler() = default;
  virtual void on_open(const Element& element) = 0;
  virtual void on_close(std::string_view name) = 0;
};

struct ParseOptions {
  /// Malformed constructs tolerated before giving up (real exports have a few).
  std::uint64_t max_errors = 10'000;
  /// Bytes between on_progress calls (whole-document parsing only).
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

inline constexpr std::size_t kMaxAttributes = 32;

class XmlStreamParser {
 public:
  explicit XmlStreamParser(ParseOptions options = {});
  ParseStats parse(std::string_view document, XmlHandler& handler);

 private:
  ParseOptions options_;
};

class IncrementalXmlParser {
 public:
  explicit IncrementalXmlParser(XmlHandler& handler, ParseOptions options = {});

  /// Parses every complete construct in carry-over + chunk. False once aborted.
  bool feed(std::string_view chunk);
  /// Parses what's left; an unterminated construct there counts as an error.
  bool finish();
  [[nodiscard]] const ParseStats& stats() const noexcept { return stats_; }

 private:
  XmlHandler& handler_;
  ParseOptions options_;
  ParseStats stats_;
  std::string carry_;
};

/// Decodes the five predefined entities and numeric character references (as UTF-8).
/// Unknown entities are left as written.
[[nodiscard]] std::string decode_entities(std::string_view raw);

}  // namespace ezt
