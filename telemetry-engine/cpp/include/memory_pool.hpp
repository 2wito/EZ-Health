#pragma once

// Fixed-block memory pool.
//
// Every block has the same size, so allocation and deallocation are O(1):
// allocate pops the intrusive free list (or bumps a pointer through the newest
// chunk), deallocate pushes the block back. Memory is requested from the system
// one chunk (thousands of blocks) at a time and only returned on release() or
// destruction.
//
// PoolResource wraps the pool as a std::pmr::memory_resource, so node-based
// standard containers (std::pmr::unordered_map, std::pmr::list, ...) get their
// per-node allocations from the pool without a custom container.
//
// Neither class is thread-safe. Give each thread its own pool.

#include <cstddef>
#include <cstdint>
#include <memory_resource>
#include <vector>

namespace ezt {

struct PoolStats {
  std::size_t block_size = 0;
  std::size_t blocks_per_chunk = 0;
  std::size_t chunks = 0;
  std::size_t blocks_in_use = 0;
  std::size_t peak_blocks_in_use = 0;
  std::uint64_t allocations = 0;
  /// Requests too large for a block, forwarded upstream (PoolResource only).
  std::uint64_t upstream_allocations = 0;

  [[nodiscard]] std::size_t reserved_bytes() const noexcept { return chunks * blocks_per_chunk * block_size; }
};

class FixedBlockPool {
 public:
  static constexpr std::size_t alignment = alignof(std::max_align_t);

  /// block_size is rounded up to a multiple of `alignment` (and to at least a pointer).
  explicit FixedBlockPool(std::size_t block_size, std::size_t blocks_per_chunk = 4096);
  ~FixedBlockPool();

  FixedBlockPool(const FixedBlockPool&) = delete;
  FixedBlockPool& operator=(const FixedBlockPool&) = delete;
  FixedBlockPool(FixedBlockPool&&) = delete;
  FixedBlockPool& operator=(FixedBlockPool&&) = delete;

  /// O(1). Throws std::bad_alloc when a new chunk can't be obtained.
  [[nodiscard]] void* allocate();
  /// O(1). `block` must come from this pool's allocate().
  void deallocate(void* block) noexcept;
  /// Returns every chunk to the system. All outstanding blocks become invalid.
  void release() noexcept;

  /// O(chunks). For assertions and tests, not the hot path.
  [[nodiscard]] bool owns(const void* p) const noexcept;
  [[nodiscard]] std::size_t block_size() const noexcept { return block_size_; }
  [[nodiscard]] PoolStats stats() const noexcept;

 private:
  struct FreeNode {
    FreeNode* next;
  };

  void grow();

  std::size_t block_size_;
  std::size_t blocks_per_chunk_;
  FreeNode* free_list_ = nullptr;
  std::byte* bump_ = nullptr;
  std::byte* bump_end_ = nullptr;
  std::vector<std::byte*> chunks_;
  std::size_t in_use_ = 0;
  std::size_t peak_in_use_ = 0;
  std::uint64_t allocations_ = 0;
};

class PoolResource final : public std::pmr::memory_resource {
 public:
  explicit PoolResource(std::size_t block_size, std::size_t blocks_per_chunk = 4096,
                        std::pmr::memory_resource* upstream = std::pmr::new_delete_resource());

  [[nodiscard]] PoolStats stats() const noexcept;
  [[nodiscard]] FixedBlockPool& pool() noexcept { return pool_; }

 private:
  void* do_allocate(std::size_t bytes, std::size_t align) override;
  void do_deallocate(void* p, std::size_t bytes, std::size_t align) override;
  [[nodiscard]] bool do_is_equal(const std::pmr::memory_resource& other) const noexcept override {
    return this == &other;
  }
  [[nodiscard]] bool fits(std::size_t bytes, std::size_t align) const noexcept {
    return bytes <= pool_.block_size() && align <= FixedBlockPool::alignment;
  }

  FixedBlockPool pool_;
  std::pmr::memory_resource* upstream_;
  std::uint64_t upstream_allocations_ = 0;
};

}  // namespace ezt
