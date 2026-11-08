#pragma once

// JSON encoding of individual records, shaped exactly like the records that
// POST /api/import/:id/batch accepts (src/lib/apple-health/batch-schema.ts).
// Shared by the CLI's NDJSON output and the WebAssembly build.

#include <cstdint>
#include <string>
#include <string_view>

#include "health_records.hpp"

namespace ezt {

void append_json_string(std::string& out, std::string_view s);
void append_json_number(std::string& out, double v);  // NaN / inf → null
void append_json_int(std::string& out, std::int64_t v);
void append_iso_ms(std::string& out, std::int64_t utc_ms);  // "2026-10-24T05:05:00.000Z", quoted
void append_iso_day(std::string& out, std::int32_t day);    // midnight UTC, quoted
void append_date(std::string& out, std::int32_t day);       // "YYYY-MM-DD", quoted

void append_sample_json(std::string& out, const MetricSample& s, const SourceTable& sources);
void append_sleep_json(std::string& out, const SleepSegment& s, const SourceTable& sources);
void append_workout_json(std::string& out, const WorkoutRecord& w, const SourceTable& sources);
void append_activity_json(std::string& out, const DailyActivity& a);

}  // namespace ezt
