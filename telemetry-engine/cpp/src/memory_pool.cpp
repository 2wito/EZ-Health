#include "memory_pool.hpp"

#include <algorithm>
#include <cstdint>
#include <new>
#include <stdexcept>

namespace ezt {

namespace {

constexpr std::size_t round_up(std::size_t n, std::size_t multiple) { return (n + multiple - 1) / multiple * multiple; }

}  // namespace

FixedBlockPool::FixedBlockPool(std::size_t block_size, std::size_t blocks_per_chunk)
    : block_size_(round_up(std::max(block_size, sizeof(FreeNode)), alignment)), blocks_per_chunk_(blocks_per_chunk) {
  if (block_size == 0 || blocks_per_chunk == 0) {
    throw std::invalid_argument("FixedBlockPool: block size and blocks per chunk must be positive");
  }
}

FixedBlockPool::~FixedBlockPool() { release(); }

void* FixedBlockPool::allocate() {
  void* block;
  if (free_list_ != nullptr) {
    block = free_list_;
    free_list_ = free_list_->next;
  } else {
    if (bump_ == bump_end_) grow();
    block = bump_;
    bump_ += block_size_;
  }
  ++allocations_;
  if (++in_use_ > peak_in_use_) peak_in_use_ = in_use_;
  return block;
}

void FixedBlockPool::deallocate(void* block) noexcept {
  if (block == nullptr) return;
  free_list_ = ::new (block) FreeNode{free_list_};
  --in_use_;
}

void FixedBlockPool::grow() {
  const std::size_t bytes = block_size_ * blocks_per_chunk_;
  auto* chunk = static_cast<std::byte*>(::operator new(bytes, std::align_val_t{alignment}));
  try {
    chunks_.push_back(chunk);
  } catch (...) {
    ::operator delete(chunk, std::align_val_t{alignment});
    throw;
  }
  bump_ = chunk;
  bump_end_ = chunk + bytes;
}

void FixedBlockPool::release() noexcept {
  for (std::byte* chunk : chunks_) ::operator delete(chunk, std::align_val_t{alignment});
  chunks_.clear();
  free_list_ = nullptr;
  bump_ = bump_end_ = nullptr;
  in_use_ = 0;
}

bool FixedBlockPool::owns(const void* p) const noexcept {
  const auto addr = reinterpret_cast<std::uintptr_t>(p);
  const std::size_t chunk_bytes = block_size_ * blocks_per_chunk_;
  return std::any_of(chunks_.begin(), chunks_.end(), [&](const std::byte* chunk) {
    const auto base = reinterpret_cast<std::uintptr_t>(chunk);
    return addr >= base && addr < base + chunk_bytes && (addr - base) % block_size_ == 0;
  });
}

PoolStats FixedBlockPool::stats() const noexcept {
  PoolStats s;
  s.block_size = block_size_;
  s.blocks_per_chunk = blocks_per_chunk_;
  s.chunks = chunks_.size();
  s.blocks_in_use = in_use_;
  s.peak_blocks_in_use = peak_in_use_;
  s.allocations = allocations_;
  return s;
}

PoolResource::PoolResource(std::size_t block_size, std::size_t blocks_per_chunk, std::pmr::memory_resource* upstream)
    : pool_(block_size, blocks_per_chunk), upstream_(upstream) {}

void* PoolResource::do_allocate(std::size_t bytes, std::size_t align) {
  if (fits(bytes, align)) return pool_.allocate();
  ++upstream_allocations_;
  return upstream_->allocate(bytes, align);
}

void PoolResource::do_deallocate(void* p, std::size_t bytes, std::size_t align) {
  // The pmr contract passes the same size and alignment as the allocation,
  // so the same test routes the block back to where it came from.
  if (fits(bytes, align)) {
    pool_.deallocate(p);
  } else {
    upstream_->deallocate(p, bytes, align);
  }
}

PoolStats PoolResource::stats() const noexcept {
  PoolStats s = pool_.stats();
  s.upstream_allocations = upstream_allocations_;
  return s;
}

}  // namespace ezt
