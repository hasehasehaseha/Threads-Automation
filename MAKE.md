# Make接続の作業状況

更新: 2026-10-23

## 投稿配信

https://eu2.make.com/556148/scenarios/10021080/edit

- 保存済み。Inactive。CloudflareのAUTOMATION_ENABLEDも未有効化。
- Asia/Tokyoの08:00 / 12:00 / 20:00、Daily 3回を設定済み。
- HTTP開始モジュールに時計を移動。シナリオ全体実行で/api/automation/checkの200とconnected:trueを確認。
- claim → 投稿ありフィルター → Threadsコンテナ作成 → 公開 → result報告を構成。
- 作成・公開エラーはneeds_reviewを報告してRollbackで停止。公開の自動再試行は設定しない。
- 結果保存失敗もRollbackで停止。外部Threads投稿はRollbackでは取消されないため、照合して手動復旧する。
- 順次処理を有効化。不完全実行の自動再試行は無効。
- Threads接続 /me でneis_hiroshimaとIDを確認済み。実投稿は未実施。
- 本文・IDマッピングはBlueprintで確認済み。実データの全体動作は未検証。

## 配信済みAPI

- /api/automation/check
- /api/automation/claim
- /api/automation/result

MAKE_API_TOKENはCloudflare SecretとMakeの接続に登録済み。
Supabase service_roleはMakeには渡していない。
002_automation_result.sql適用済み。Worker 4982103配信済み。

## AI下書き・分析

OpenAI API利用をユーザーが選択。MakeでAI下書き生成シナリオを準備中。
既存My OpenAI connectionは401。Danbara OpenAI接続のキー入力をユーザーに依頼。
AIの方針取得・生成・下書き保存は未実装。反響取得とトークン更新も未完了。
本番自動投稿は必要な検証が完了するまで有効化しない。
