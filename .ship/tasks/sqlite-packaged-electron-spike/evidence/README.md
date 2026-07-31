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
| runtime | passed | 28 | 0 | 0 | 0 |
| app-database | passed | 515 | 2 | 110592 | 0 |
| session-catalog | passed | 42 | 2 | 110592 | 0 |
| permission-rules | passed | 31 | 1 | 110592 | 0 |
| pi-session-store | passed | 81 | 1 | 188416 | 0 |
| bootstrap | passed | 24 | 0 | 81920 | 0 |
| ordered-entries | passed | 1734 | 1000 | 888832 | 0 |
| session-isolation | passed | 372 | 200 | 245760 | 0 |
| crash-recovery | passed | 1494 | 255 | 307200 | 0 |
| compaction | passed | 31 | 4 | 81920 | 0 |
| delete-cleanup | passed | 21 | 100 | 245760 | 0 |
| wal-backup-restore | passed | 1832 | 1001 | 884736 | 0 |
| legacy-import | passed | 242 | 35 | 90112 | 0 |

## Compatibility warnings
- model_change.channelId 以 legacy.model_change 保存，未伪装为 provider。
- truncate 按现有最早截断点语义恢复 active context。

## Verification
- bun run typecheck
- bun test
- bun run build
- bun run spike:sqlite
