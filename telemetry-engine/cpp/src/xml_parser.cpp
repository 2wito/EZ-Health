#include "xml_parser.hpp"

#include <array>
#include <charconv>
#include <cstring>

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

// ─── Scanner ────────────────────────────────────────────────────────────────

namespace {

constexpr bool is_space(char c) noexcept { return c == ' ' || c == '\n' || c == '\r' || c == '\t'; }

const char* find_char(const char* p, const char* end, char c) noexcept {
  return p < end ? static_cast<const char*>(std::memchr(p, c, static_cast<std::size_t>(end - p))) : nullptr;
}

/// Position just past `terminator`, or nullptr when it never appears.
const char* skip_past(const char* p, const char* end, std::string_view terminator) noexcept {
  if (p >= end) return nullptr;
  const std::string_view rest(p, static_cast<std::size_t>(end - p));
  const std::size_t at = rest.find(terminator);
  return at == std::string_view::npos ? nullptr : p + at + terminator.size();
}

bool starts_with(const char* p, const char* end, std::string_view prefix) noexcept {
  return static_cast<std::size_t>(end - p) >= prefix.size() && std::memcmp(p, prefix.data(), prefix.size()) == 0;
}

/// True when [p, end) could still become `prefix` once more bytes arrive.
bool could_start_with(const char* p, const char* end, std::string_view prefix) noexcept {
  const auto n = static_cast<std::size_t>(end - p);
  return n < prefix.size() && std::memcmp(p, prefix.data(), n) == 0;
}

/// p points at the '!' of "<!...". Returns the position after the construct, or nullptr.
const char* skip_declaration(const char* p, const char* end) noexcept {
  if (starts_with(p, end, "!--")) return skip_past(p + 3, end, "-->");
  if (starts_with(p, end, "![CDATA[")) return skip_past(p + 8, end, "]]>");
  if (could_start_with(p, end, "!--") || could_start_with(p, end, "![CDATA[")) return nullptr;

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

/// Scans `doc` and returns how many bytes were consumed.
///
/// With final == false, a construct cut off by the end of the buffer is left
/// unconsumed (the return value points at its '<') so the caller can retry once
/// more bytes arrive. With final == true it counts as an error instead.
std::size_t scan(std::string_view doc, XmlHandler& handler, const ParseOptions& options, ParseStats& stats,
                 bool final, std::size_t base_offset) {
  const char* const begin = doc.data();
  const char* const end = begin + doc.size();
  const char* p = begin;
  std::array<Attribute, kMaxAttributes> attrs{};
  std::size_t next_progress = options.progress_interval;

  const auto consumed = [&](const char* at) { return static_cast<std::size_t>(at - begin); };
  // Counts a malformed construct; false once there have been too many.
  const auto fail = [&](std::uint64_t n = 1) {
    stats.errors += n;
    if (stats.errors > options.max_errors) stats.aborted = true;
    return !stats.aborted;
  };

  while (p < end) {
    const char* lt = find_char(p, end, '<');
    if (lt == nullptr) return doc.size();  // trailing text: nothing to keep
    p = lt + 1;
    if (p >= end) {
      if (!final) return consumed(lt);
      fail();
      return doc.size();
    }

    if (options.on_progress && base_offset + consumed(p) >= next_progress) {
      options.on_progress(base_offset + consumed(p));
      next_progress += options.progress_interval;
    }

    const char c = *p;
    if (c == '?' || c == '!') {
      const char* after = c == '?' ? skip_past(p + 1, end, "?>") : skip_declaration(p, end);
      if (after == nullptr) {
        if (!final) return consumed(lt);
        fail();
        return doc.size();
      }
      p = after;
      continue;
    }

    if (c == '/') {
      const char* gt = find_char(p + 1, end, '>');
      if (gt == nullptr) {
        if (!final) return consumed(lt);
        fail();
        return doc.size();
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
    std::uint64_t excess = 0;  // attributes beyond kMaxAttributes, reported once the tag is complete
    bool self_closing = false;
    bool ok = !name.empty();
    bool truncated = false;  // ran out of input rather than hitting bad syntax
    while (ok) {
      while (q < end && is_space(*q)) ++q;
      if (q >= end) {
        ok = false;
        truncated = true;
        break;
      }
      if (*q == '>') {
        ++q;
        break;
      }
      if (*q == '/') {
        if (q + 1 >= end) {
          ok = false;
          truncated = true;
        } else if (q[1] == '>') {
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
      if (q >= end) {
        ok = false;
        truncated = true;
        break;
      }
      if (attr_name.empty() || *q != '=') {
        ok = false;
        break;
      }
      ++q;
      while (q < end && is_space(*q)) ++q;
      if (q >= end) {
        ok = false;
        truncated = true;
        break;
      }
      if (*q != '"' && *q != '\'') {
        ok = false;
        break;
      }
      const char quote = *q++;
      const char* close = find_char(q, end, quote);
      if (close == nullptr) {
        ok = false;
        truncated = true;
        break;
      }
      if (count < kMaxAttributes) {
        attrs[count++] = Attribute{attr_name, std::string_view(q, static_cast<std::size_t>(close - q))};
      } else {
        ++excess;
      }
      q = close + 1;
    }
    if (name.empty() && q >= end) truncated = true;

    if (!ok) {
      if (truncated && !final) return consumed(lt);
      // Resynchronise on the end of this tag.
      const char* gt = find_char(q < end ? q : end, end, '>');
      if (gt == nullptr && !final) return consumed(lt);
      if (!fail()) return consumed(gt == nullptr ? end : gt + 1);
      p = gt == nullptr ? end : gt + 1;
      continue;
    }

    if (excess > 0 && !fail(excess)) return consumed(q);
    ++stats.elements;
    handler.on_open(Element{name, std::span<const Attribute>(attrs.data(), count)});
    if (self_closing) handler.on_close(name);
    p = q;
  }
  return consumed(p);
}

}  // namespace

// ─── Whole-document parser ──────────────────────────────────────────────────

XmlStreamParser::XmlStreamParser(ParseOptions options) : options_(std::move(options)) {}

ParseStats XmlStreamParser::parse(std::string_view document, XmlHandler& handler) {
  ParseStats stats;
  stats.bytes = document.size();
  scan(document, handler, options_, stats, /*final=*/true, 0);
  return stats;
}

// ─── Incremental parser ─────────────────────────────────────────────────────

IncrementalXmlParser::IncrementalXmlParser(XmlHandler& handler, ParseOptions options)
    : handler_(handler), options_(std::move(options)) {
  options_.on_progress = nullptr;  // offsets aren't meaningful across chunks
}

bool IncrementalXmlParser::feed(std::string_view chunk) {
  if (stats_.aborted) return false;
  stats_.bytes += chunk.size();

  if (carry_.empty()) {
    // Common case: parse the caller's buffer in place, keep only an unfinished tail.
    const std::size_t used = scan(chunk, handler_, options_, stats_, false, 0);
    carry_.assign(chunk.substr(used));
  } else {
    carry_.append(chunk);
    const std::size_t used = scan(carry_, handler_, options_, stats_, false, 0);
    carry_.erase(0, used);
  }

  // A real tag is a few hundred bytes. A carry-over this large is an
  // unterminated construct; rescanning it on every chunk would be quadratic.
  constexpr std::size_t kMaxCarry = std::size_t{8} << 20;
  if (carry_.size() > kMaxCarry) {
    if (++stats_.errors > options_.max_errors) stats_.aborted = true;
    carry_.clear();
  }
  return !stats_.aborted;
}

bool IncrementalXmlParser::finish() {
  if (!stats_.aborted && !carry_.empty()) {
    scan(carry_, handler_, options_, stats_, true, 0);
    carry_.clear();
  }
  return !stats_.aborted;
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
      // Surrogates aren't characters: decoding one would produce invalid UTF-8.
      decoded = ec == std::errc{} && ptr == digits.data() + digits.size() && !digits.empty() && cp <= 0x10FFFF &&
                (cp < 0xD800 || cp > 0xDFFF);
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

}  // namespace ezt
