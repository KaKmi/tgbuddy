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
| runtime | passed | 0 | 0 | 0 | 0 |
| app-database | passed | 26 | 2 | 24576 | 0 |
| session-catalog | passed | 30 | 2 | 24576 | 0 |
| pi-session-store | passed | 69 | 1 | 110592 | 0 |
| bootstrap | passed | 27 | 0 | 81920 | 0 |
| ordered-entries | passed | 2023 | 1000 | 888832 | 0 |
| session-isolation | passed | 613 | 200 | 245760 | 0 |
| crash-recovery | passed | 5334 | 223 | 286720 | 0 |
| compaction | passed | 43 | 4 | 81920 | 0 |
| delete-cleanup | passed | 39 | 100 | 245760 | 0 |
| wal-backup-restore | passed | 2784 | 1001 | 884736 | 0 |
| legacy-import | passed | 212 | 23 | 90112 | 0 |

## Compatibility warnings
- model_change.channelId 以 legacy.model_change 保存，未伪装为 provider。
- truncate 按现有最早截断点语义恢复 active context。

## Verification
- bun run typecheck
- bun test
- bun run build
- bun run spike:sqlite
