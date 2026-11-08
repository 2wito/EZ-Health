#pragma once

// C API used by the WebAssembly build (src/lib/apple-health/wasm-engine.ts).
//
//   s = ezt_create()
//   for each chunk:  p = ezt_input(s, n); copy n bytes to p; ezt_feed(s, n)
//   ezt_finish(s)                        → stats JSON in ezt_output(s)
//   for each kind:   ezt_page(s, kind, offset, limit) → JSON array in ezt_output(s)
//   ezt_destroy(s)
//
// Kinds: 0 samples, 1 sleepStages, 2 workouts, 3 activity. Records have the
// shape of src/lib/apple-health/batch-schema.ts. Return codes: 0 ok, 1 too
// many XML errors (not an Apple Health export), 2 bad call.
//
// It also compiles natively, so the tests exercise exactly this surface.

#include <stddef.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EZT_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EZT_EXPORT
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct EztSession EztSession;

EZT_EXPORT EztSession* ezt_create(void);
EZT_EXPORT void ezt_destroy(EztSession* session);

/// A buffer of n bytes inside the module for the next chunk (valid until the next call).
EZT_EXPORT char* ezt_input(EztSession* session, size_t n);
EZT_EXPORT int ezt_feed(EztSession* session, size_t n);
EZT_EXPORT double ezt_records_read(const EztSession* session);

EZT_EXPORT int ezt_finish(EztSession* session);
EZT_EXPORT size_t ezt_count(const EztSession* session, int kind);
EZT_EXPORT int ezt_page(EztSession* session, int kind, size_t offset, size_t limit);

/// The last JSON produced by ezt_finish / ezt_page (UTF-8, not NUL-terminated).
EZT_EXPORT const char* ezt_output(const EztSession* session);
EZT_EXPORT size_t ezt_output_size(const EztSession* session);

#ifdef __cplusplus
}
#endif
