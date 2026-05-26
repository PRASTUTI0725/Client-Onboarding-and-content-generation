# GitHub Readiness Checklist

## Environment Files
- [ ] .env files are ignored by .gitignore (except .env.example)
- [ ] No actual secrets committed to repository
- [ ] .env.example files exist with placeholder values
- [ ] Root .env.example created
- [ ] artifacts/api-server/.env.example created
- [ ] artifacts/strategy-engine/.env.example created

## Logs and Test Reports
- [ ] Log files (*.log, *.err.log) identified for removal
- [ ] Test reports (playwright-report/) identified for removal
- [ ] Test results (test-results/) identified for removal
- [ ] Temporary files (tmp-*) identified for removal

## Generated Files
- [ ] Generated source directories (src/generated/, src/.generated/) identified
- [ ] Build output directories (dist/) identified
- [ ] Verification that generated files can be safely regenerated
- [ ] Vite cache directories (.vite-temp/) identified for ignoring

## Build and Typecheck
- [ ] Typecheck passes (pnpm run typecheck)
- [ ] Build passes (pnpm run build)
- [ ] No compilation errors in core application logic

## Documentation
- [ ] README.md reviewed and up-to-date
- [ ] Setup instructions clear and complete
- [ ] Architecture overview documented
- [ ] Workflow overview documented
- [ ] Client brief format documented
- [ ] Current limitations documented

## Repository Hygiene
- [ ] .gitignore updated with comprehensive ignore patterns
- [ ] Large binary files evaluated for archival/storage
- [ ] No source code deleted or modified
- [ ] No architecture refactoring performed
- [ ] Backup created before cleanup (backup/pre-cleanup-YYYYMMDD)
- [ ] Cleanup branch created (cleanup/repo-hygiene-YYYYMMDD)

## Final Verification
- [ ] git status shows only intended changes
- [ ] All tests still pass after .gitignore updates
- [ ] Ready for GitHub push

