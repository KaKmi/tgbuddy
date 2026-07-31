# SQLite Packaged Electron Spike Evidence

## Baseline
- Git: 4735c9da87d5a8a65e074175b34562efaff4dd83
- Command: bun run spike:sqlite

## Runtime
- app.isPackaged: true
- ASAR: true
- Electron: 39.8.10
- Node: 22.22.1
- SQLite: 3.51.2
- pi storage: 0.82.1

## Scenarios
| Scenario | Result | Duration | Entries | DB bytes | WAL bytes |
|---|---|---:|---:|---:|---:|
| runtime | passed | 1 | 0 | 0 | 0 |
| app-database | passed | 36 | 2 | 53248 | 0 |
| session-catalog | passed | 41 | 2 | 53248 | 0 |
| permission-rules | passed | 28 | 1 | 53248 | 0 |
| pi-session-store | passed | 105 | 1 | 139264 | 0 |
| bootstrap | passed | 27 | 0 | 81920 | 0 |
| ordered-entries | passed | 1857 | 1000 | 888832 | 0 |
| session-isolation | passed | 411 | 200 | 245760 | 0 |
| crash-recovery | passed | 2128 | 251 | 299008 | 0 |
| compaction | passed | 33 | 4 | 81920 | 0 |
| delete-cleanup | passed | 26 | 100 | 245760 | 0 |
| wal-backup-restore | passed | 2076 | 1001 | 884736 | 0 |
| legacy-import | passed | 322 | 35 | 90112 | 0 |

## Compatibility warnings
- model_change.channelId 以 legacy.model_change 保存，未伪装为 provider。
- truncate 按现有最早截断点语义恢复 active context。

## Verification
- bun run typecheck
- bun test
- bun run build
- bun run spike:sqlite
