cmake_minimum_required(VERSION 3.20)
project(ez_telemetry VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

option(EZT_WERROR "Treat warnings as errors" OFF)
option(EZT_SANITIZE "Build with AddressSanitizer + UndefinedBehaviorSanitizer" OFF)
option(EZT_NATIVE "Tune for this machine's CPU (-march=native); not portable" OFF)
option(EZT_BUILD_TESTS "Build the unit tests" ON)

find_package(Threads REQUIRED)

# Warnings and optimisation, applied to every target below.
add_library(ezt_options INTERFACE)
if(MSVC)
  target_compile_options(ezt_options INTERFACE /W4 /permissive- $<$<CONFIG:Release>:/O2>)
  if(EZT_WERROR)
    target_compile_options(ezt_options INTERFACE /WX)
  endif()
else()
  target_compile_options(ezt_options INTERFACE
    -Wall -Wextra -Wpedantic -Wshadow
    $<$<CONFIG:Release>:-O3>
    $<$<CONFIG:RelWithDebInfo>:-O3 -g>)
  if(EZT_WERROR)
    target_compile_options(ezt_options INTERFACE -Werror)
  endif()
  if(EZT_NATIVE)
    target_compile_options(ezt_options INTERFACE -march=native)
  endif()
  if(EZT_SANITIZE)
    target_compile_options(ezt_options INTERFACE -fsanitize=address,undefined -fno-omit-frame-pointer -g -O1)
    target_link_options(ezt_options INTERFACE -fsanitize=address,undefined)
  endif()
endif()

add_library(ezt_core STATIC
  src/memory_pool.cpp
  src/xml_parser.cpp
  src/health_records.cpp
  src/aggregator.cpp
  src/output.cpp)
target_include_directories(ezt_core PUBLIC include)
target_link_libraries(ezt_core PUBLIC ezt_options Threads::Threads)

add_executable(ez-telemetry src/main.cpp)
target_link_libraries(ez-telemetry PRIVATE ezt_core)

if(EZT_BUILD_TESTS)
  enable_testing()
  add_executable(engine_tests tests/engine_tests.cpp)
  target_link_libraries(engine_tests PRIVATE ezt_core)
  add_test(NAME engine_tests COMMAND engine_tests)
endif()

install(TARGETS ez-telemetry RUNTIME DESTINATION bin)
