# Site Archive

Dated snapshots of previously published versions of lateeflaw.info.
Each folder is a rollback point.

## Workflow

Before publishing a new design:
1. Copy current live files into archive/YYYY-MM-DD_<tag>/
2. Tag describes what is being replaced or what is coming
3. Confirm archive was written before replacing live files

## Snapshots

| Folder | Date | Description |
|---|---|---|
| 2026-08-25_baseline | 2026-08-25 | First baseline snapshot — pre-automation |

## To Restore

Copy the desired archive folder's index.html back to root:
  cp archive/YYYY-MM-DD_tag/index.html index.html
  git add index.html
  git commit -m "Rollback to YYYY-MM-DD snapshot"
  git push origin main
