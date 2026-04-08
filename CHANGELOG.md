# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Unified error display system with ErrorBuilder utility
- Enhanced InfoBanner component with type-specific styling
- Actual API error messages shown to users (e.g., "Token refresh failed: 401")
- Timeout error detection and display
- DisplayError TypeScript interface for error normalization

### Changed
- Error messages now show raw technical errors instead of generic messages
- InfoBanner component accepts both message and error props
- Improved error reporting with visual indicators (colors and icons)
