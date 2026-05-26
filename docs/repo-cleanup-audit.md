# Repository Cleanup Audit Report

## 1. Current Project Structure Summary

### Main Applications/Packages
- **lib/** - Contains core library packages:
  - `lib/api-client-react` - React API client
  - `lib/api-spec` - API specification package
  - `lib/api-zod` - Zod schema definitions
  - `lib/db` - Database package
- **artifacts/** - Deployable application services:
  - `artifacts/api-server` - Main API server
  - `artifacts/strategy-engine` - Strategy processing engine
  - `artifacts/mockup-sandbox` - UI mockup/testing environment
- **scripts/** - Utility scripts and MCP servers

### Frontend Location
- `artifacts/mockup-sandbox/src/` - React-based UI/mockup interface
- `lib/api-client-react/src/` - React API client components

### Backend/API Location
- `artifacts/api-server/src/` - Node.js/Express API server
- `artifacts/strategy-engine/src/` - Strategy processing service

### Shared Packages
- `lib/api-spec/` - Shared API type definitions
- `lib/api-zod/` - Shared validation schemas
- `lib/db/` - Shared database models and utilities

### Documentation
- `artifacts/docs/` - Existing documentation folder
- `docs/` - Newly created docs folder (empty)

### Scripts
- `scripts/` - Contains MCP server implementations and utility scripts
- Root-level npm scripts in package.json

### Generated Folders
- `*/dist/` - Built/compiled output directories
- `*/node_modules/` - Dependency folders
- `*/src/generated/` - Auto-generated code
- `*/src/.generated/` - Hidden generated folders
- `playwright-report/` - E2E test reports
- `test-results/` - Test result outputs

### Config Files
- Root: `.gitignore`, `.npmrc`, `.mcp.json`, `.opencode.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`
- Package-specific: `package.json`, `tsconfig.json` in each package
- Playwright: `playwright.config.ts`

## 2. Important Files/Folders That Must NOT Be Deleted

### Core Application Logic
- `artifacts/api-server/src/` - API server implementation
- `artifacts/strategy-engine/src/` - Strategy engine implementation
- `lib/` - All core library packages
- `scripts/` - MCP servers and utility scripts

### Configuration Files
- `pnpm-workspace.yaml` - Workspace configuration
- `.gitignore` - Git ignore rules
- `tsconfig.base.json` - Base TypeScript configuration
- `package.json` - Workspace manifest
- `.opencode.json` - Opencode configuration
- `.mcp.json` - MCP server configuration

### Documentation & Specs
- `README.md` - Main project documentation
- `AGENTS.md` - Agent instructions
- `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules` - AI assistant configs
- `artifacts/docs/` - Existing documentation

### Critical Data/Assets
- `attached_assets/` - User-uploaded assets
- `fixtures/` - Test fixtures/data
- `G0DM0D3/` - Unknown but appears to be user data

## 3. Suspicious/Messy Files or Folders

### Safe to Delete
- **Log files**: All `*.log` and `*.err.log` files in root directory
- **Temporary session files**: `tmp-*.log`, `tmp-*.err.log` files
- **Empty files**: `$null` file in root
- **Cache files**: `.vite-temp` directories in node_modules

### Probably Safe but Verify
- **Test reports**: `playwright-report/` (may contain useful test results)
- **Test results**: `test-results/` (may contain CI artifacts)
- **RC candidate**: `artifacts/rc-candidate/` (may contain release candidates)
- **Notes**: `artifacts/notes/` (may contain useful meeting notes)

### Do Not Delete
- All source code directories (`src/`)
- Configuration files
- Documentation directories
- `node_modules/` (managed by package manager)
- `dist/` (build outputs, but can be rebuilt)

### Move to Docs/Archive
- Screenshot exports: `*.png` files in artifacts/ (founder-*.png, final-*.png)
- Debug images: `*debug*.png`, `reflkt-debug*.png`
- PDF exports: `*.pdf` files in artifacts/
- JSON exports: `*.json` files in artifacts/ that appear to be exports

### Add to .gitignore
- All `*.log` files
- All `tmp-*` files
- `playwright-report/`
- `test-results/`
- `.vite-temp/` directories
- `src/.generated/` and `src/generated/` (if safe to regenerate)
- `.DS_Store` (if present)
- `Thumbs.db` (if present)

## 4. Backup/Duplicate Folders Found

### Clear Backup/Temporary Folders
- `test-results/` - Test output directory
- `.git/refs/remotes/gitsafe-backup/` - Git backup remote
- `.git/logs/refs/remotes/gitsafe-backup/` - Git logs for backup

### Generated/Export Folders (May Contribute to Bloat)
- `artifacts/mockup-sandbox/src/.generated/` - Generated React components
- `artifacts/mockup-sandbox/src/generated/` - Generated files
- `artifacts/strategy-engine/node_modules/.vite-temp/` - Vite temp cache
- `artifacts/api-server/node_modules/.vite-temp/` - Vite temp cache
- `lib/api-client-react/dist/generated/` - Generated API client
- `lib/api-client-react/src/generated/` - Generated source
- `lib/api-zod/dist/generated/` - Generated zod schemas
- `lib/api-zod/src/generated/` - Generated zod source

## 5. GitHub Readiness Check

### .gitignore Analysis
Current `.gitignore` appears basic. Missing entries for:
- Log files (`*.log`)
- Temporary files (`tmp-*`)
- Test reports (`playwright-report/`, `test-results/`)
- Vite temp directories (`.vite-temp/`)
- Generated source directories (`src/generated/`, `src/.generated/`)
- Environment files (should keep `.env.example` but ignore `.env.local`)

### Environment Files & Secrets
- Found: `artifacts/api-server/.env.local` (should be in .gitignore)
- Found: `artifacts/strategy-engine/.env.local` (should be in .gitignore)
- No obvious API keys/secrets visible in file names, but env files may contain them

### Node Modules & Build Folders
- Multiple `node_modules/` directories present (expected in monorepo)
- Multiple `dist/` directories present (build outputs)
- These should be in .gitignore but are necessary for local development

### Large Files
- Several large PNG files in artifacts/ (1-2MB each):
  - `final-instagram-dna.png` (1.2MB)
  - `final-pdf-result.png` (1.2MB)
  - `founder-business-dna-notes.png` (1.1MB)
  - `founder-calendar-result.png` (58KB)
  - `founder-demo-safe-export.png` (1.2MB)
  - `founder-pdf-export-result.png` (1.2MB)
  - `founder-strategy-result.png` (1.1MB)
- These appear to be export/render outputs that could be moved to docs/archive

### Duplicate Assets
- No obvious duplicate files detected by name
- Generated files may duplicate source functionality

## 6. Dependency/Package Structure

### Package.json Files
- Root `package.json` - Workspace configuration
- `lib/api-client-react/package.json` - API client package
- `lib/api-spec/package.json` - API spec package
- `lib/api-zod/package.json` - Zod schema package
- `lib/db/package.json` - Database package
- `artifacts/api-server/package.json` - API server
- `artifacts/strategy-engine/package.json` - Strategy engine
- `artifacts/mockup-sandbox/package.json` - Mockup sandbox

### PNPM Workspace
- `pnpm-workspace.yaml` defines workspace structure
- `pnpm-lock.yaml` present (140KB) - lockfile is committed (acceptable for PNPM)
- Root package.json uses `"private": true` - correct for workspace

### Scripts Analysis
- Root scripts include build, typecheck, test, and start commands
- Appears reasonable and well-documented
- No obviously unused scripts

### Structure Understandability
- Clear separation: libs (shared packages), artifacts (services), scripts (utilities)
- Consistent naming conventions
- Structure is understandable for new contributors

## 7. Docs Cleanup Suggestion

### Essential Docs That Should Exist
- `README.md` - **Exists** (good start, 9KB)
- Setup instructions - Should be in README or separate SETUP.md
- Environment example - `.env.example` file showing required variables
- Architecture overview - `ARCHITECTURE.md` explaining service boundaries
- Workflow overview - `WORKFLOW.md` explaining client onboarding flow
- Client brief format - `CLIENT-BRIEF.md` explaining input format
- Current limitations - `LIMITATIONS.md` documenting known issues
- API documentation - Reference to API specs or generated docs
- Contributing guidelines - `CONTRIBUTING.md` for external contributors
- Changelog - `CHANGELOG.md` tracking versions
- License - `LICENSE` file (MIT claimed in package.json)

### Current Docs Location
- `artifacts/docs/` - Existing documentation (should be reviewed/migrated)
- Root README.md - Main documentation
- Various `.md` files for AI assistants (CLAUDE.md, GEMINI.md, AGENTS.md)

### Recommendation
1. Review `artifacts/docs/` for useful content
2. Migrate relevant content to root-level `docs/` folder
3. Create missing essential documentation files
4. Keep AI assistant config files in root (they serve a purpose)

## 8. Safe Cleanup Plan

### Step 1: Create Branch
```bash
git checkout -b cleanup/repo-hygiene-YYYYMMDD
```

### Step 2: Run Git Status
```bash
git status
```
Review current state before making changes

### Step 3: Backup Current Working State
```bash
# Create a temporary backup branch
git checkout -b backup/pre-cleanup-YYYYMMDD
git checkout cleanup/repo-hygiene-YYYYMMDD
```

### Step 4: Update .gitignore
Add patterns for:
- Log files: `*.log`, `*.err.log`
- Temporary files: `tmp-*`, `tmp-*.log`, `tmp-*.err.log`
- Test reports: `playwright-report/`, `test-results/`
- Vite cache: `.vite-temp/`
- Generated source: `src/generated/`, `src/.generated/`
- Environment files: `.env.local`, `.env.*` (but keep .env.example)
- OS files: `.DS_Store`, `Thumbs.db`

### Step 5: Remove Only Safe Junk
After reviewing and getting approval:
```bash
# Remove log files (example - review first)
rm -f *.log *.err.log
rm -f tmp-*.log tmp-*.err.log
rm -f $null

# Remove test reports (if approved)
rm -rf playwright-report/
rm -rf test-results/

# Remove vite temp directories (if approved)
find . -name ".vite-temp" -type d -exec rm -rf {} + 2>/dev/null || true
```

### Step 6: Move Useful Docs to Docs/
```bash
# Create docs subfolders if needed
mkdir -p docs/architecture docs/workflow docs/client

# Move/export relevant artifacts/docs content
# Review artifacts/docs/ first, then copy useful files
# Example:
# cp -r artifacts/docs/* docs/  # After review
```

### Step 7: Run Typecheck/Build
```bash
pnpm run typecheck
pnpm run build
```
Ensure everything still compiles correctly

### Step 8: Commit in Small Chunks
Commit logically related changes:
- gitignore updates
- Safe file removals (separate commit)
- Documentation moves (separate commit)
- Any other cleanup steps

## 9. Commands to Run (Safe for Inspection Only)

### Inspection Commands (Safe to Run Now)
```bash
# See current git status
git status

# Check .gitignore content
cat .gitignore

# List large files (>1MB)
find . -type f -size +1M -exec ls -lh {} \;

# Find log files
find . -name "*.log" -o -name "*.err.log"

# Find temporary files
find . -name "tmp-*"

# Find vite temp directories
find . -name ".vite-temp" -type d

# Find generated source directories
find . -name "generated" -type d
find . -name ".generated" -type d

# Check environment files
find . -name ".env.*" -not -name ".env.example"
```

### Cleanup Commands (Run Only After Approval)
```bash
# REVIEW OUTPUT FIRST - then uncomment to execute
# rm -f *.log *.err.log
# rm -f tmp-*.log tmp-*.err.log
# rm -f $null
# rm -rf playwright-report/
# rm -rf test-results/
# find . -name ".vite-temp" -type d -exec rm -rf {} + 2>/dev/null || true
```

## 10. Final Recommendation

### Repository Status: **Needs Cleanup First**

### Reasons:
1. **Log files cluttering root directory** - Numerous `*.log` and `tmp-*.log` files
2. **Test reports in repository** - `playwright-report/` and `test-results/` directories
3. **Large binary files in repository** - Multiple 1-2MB PNG export files in artifacts/
4. **Missing .gitignore entries** - Many temporary/generated files not ignored
5. **Environment files potentially containing secrets** - `.env.local` files not ignored
6. **Generated source directories** - `src/generated/` folders that could be ignored if safe to regenerate

### Risk Assessment:
- **Low risk to push code** - Core application logic is intact and separable from junk
- **Medium risk for repository bloat** - Large files and logs increase clone/fetch times
- **Low risk for security** - No obvious secrets found, but .env.local files should be reviewed
- **High risk for confusion** - New contributors may be confused by junk files

### Recommended Action:
1. **Create cleanup branch** and perform inspection
2. **Review .env.local files** for actual secrets before ignoring
3. **Update .gitignore** with comprehensive patterns
4. **Remove logs and temp files** after team confirmation
5. **Consider moving large export files** to docs/archive or external storage
6. **Ensure generated files can be regenerated** before ignoring them
7. **Push to GitHub** after cleanup is complete and verified

The repository core is well-structured and follows good monorepo practices. With proper cleanup of temporary files, logs, and update of .gitignore, it will be ready for GitHub.