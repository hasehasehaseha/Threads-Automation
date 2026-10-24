# Make接続の作業状況

更新: 2026-10-24

## 投稿配信
https://eu2.make.com/556148/scenarios/10021080/edit

Active。毎日08:00 / 12:00 / 20:00 Asia/Tokyo。
claim → 投稿ありフィルター → Threadsコンテナ作成 → 公開 → result報告。
作成・公開エラーはneeds_reviewを報告して停止。公開の自動再試行なし。
結果保存失敗も停止。RollbackはThreadsの公開を取り消さないため、照合が必要。
承認済み投稿なしの実行が正常終了、公開モジュール未実行を確認。実投稿の通しテストは未実施。

## AI下書き
https://eu2.make.com/556148/scenarios/10028014/edit

Active。15分ごとに生成依頼を確認。
HTTP /api/generation/claim（Danbara AI Drafts接続）→ job.idありフィルター → OpenAI Responses（Danbara OpenAI、gpt-4.1-mini、max_output_tokens2200、store false、createConversation false）→ HTTP /api/generation/result。
結果文字列はescapeJSONでJSON文字列として安全に格納。
2026-10-25分の3案を8/12/20時の未承認下書きとして保存する実動作テスト成功。
MAKE_AI_TOKENはCloudflareとMakeの専用接続に保存済み。スタッフ管理や公開には使えない。

## 反響
Cloudflareの毎日21:30 JSTのCronと管理者の手動操作で取得。最新15件、1時間内に取得済みの投稿はスキップ。
2026-10-24、管理画面の即時投稿による実公開後に手動取得を確認。17:52 JSTに1件保存・失敗0件、閲覧0・いいね1・その他0を表示。毎日Cronの実行結果は別途確認が必要。

## 残る保守
Threadsトークンの自動更新と公開結果の照合・復旧UIは未実装。
運用手順と制限はSETUP.mdを参照。
