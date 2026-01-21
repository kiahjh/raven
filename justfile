_default:
  @just --choose

dev:
    bun run tauri dev

# Run all tests
test:
    bun run test
    cargo test --manifest-path crates/raven-daemon/Cargo.toml -- --test-threads=1

# Run frontend tests only
test-frontend:
    bun run test

# Run frontend tests in watch mode
test-frontend-watch:
    bun run test:watch

# Run daemon tests only
test-daemon:
    cargo test --manifest-path crates/raven-daemon/Cargo.toml -- --test-threads=1

# Build the daemon
build-daemon:
    cargo build --manifest-path crates/raven-daemon/Cargo.toml

# Build everything
build:
    cargo build --manifest-path crates/raven-daemon/Cargo.toml
    bun run build
    cargo build --manifest-path src-tauri/Cargo.toml

