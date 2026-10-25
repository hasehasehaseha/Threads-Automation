# Make接続の作業状況

更新: 2026-10-24

## 投稿配信
https://eu2.make.com/556148/scenarios/10021080/edit

旧構成はActive、毎日08:00 / 12:00 / 20:00 Asia/Tokyo。18:05など任意時刻には起動せず、UIで予約を受け付ける不整合がありました。
42147b6（Deploy #9成功）で予約公開をCloudflare毎分Cronへ移行済み。Makeの旧配信はInactiveを確認。以下は旧フローの記録です。再有効化はしないでください。
claim → 投稿ありフィルター → Threadsコンテナ作成 → 公開 → result報告。
作成・公開エラーはneeds_reviewを報告して停止。公開の自動再試行なし。
結果保存失敗も停止。RollbackはThreadsの公開を取り消さないため、照合が必要。
承認済み投稿なしの実行が正常終了、公開モジュール未実行を確認。実投稿の通しテストは未実施。

## AI下書き
https://eu2.make.com/556148/scenarios/10028014/edit

Active。15分ごとに生成依頼を確認。
HTTP /api/generation/claim（Danbara AI Drafts接続）→ job.idありフィルター → OpenAI Responses（Danbara OpenAI、gpt-4.1-mini、max_output_tokens2200、store false、createConversation false）→ HTTP /api/generation/result。
結果文字列はescapeJSONでJSON文字列として安全に格納。
プロンプト管理追加後もMakeのモジュール変更は不要。claimのjob.promptが、ジョブに保存した個別プロンプトと共通方針を結合した指示になります。通常生成と公開しないテスト生成は同じシナリオを使い、resultの保存先をサーバー/DBで分けます。
2026-10-24 23:44〜23:45、管理画面でテスト依頼→Make Run once→OpenAI→テスト履歴3案表示を実確認。テストだけではposts件数が増えないことも確認。
シナリオを開くと古いOpenAI設定の回復案内が出る場合があります。現在の保存済みシナリオで成功確認済みのため、古い未保存変更をRecover/保存しないでください。案内は閉じました。
2026-10-25分の3案を8/12/20時の未承認下書きとして保存する実動作テスト成功。
MAKE_AI_TOKENはCloudflareとMakeの専用接続に保存済み。スタッフ管理や公開には使えない。

## 反響
Cloudflareの毎日21:30 JSTのCronと管理者の手動操作で取得。最新15件、1時間内に取得済みの投稿はスキップ。
2026-10-24、管理画面の即時投稿による実公開後に手動取得を確認。17:52 JSTに1件保存・失敗0件、閲覧0・いいね1・その他0を表示。同日21:30 JSTのCronもDB記録で成功確認（閲覧11・いいね1）。

## 現行の予約公開
Cloudflare毎分Cronで承認済み予約を原子的に取得し、準備状態確認→公開→結果保存。6440f34 / Deploy #10成功。23:10 JST予約が23:10:57に公開済みとなり、Threads実投稿・Meta投稿ID保存を照合済み。
https://www.threads.com/@neis_hiroshima/post/De4UPGAlfiK
Makeの配信シナリオは停止したまま。AI生成シナリオは変更していません。

## 残る保守
ThreadsトークンはCloudflare/Supabaseで自動更新する構成へ移行済み（1039b66 / Deploy #11、初回実更新成功）。停止済みMakeの旧Threads接続には更新しません。AIシナリオはThreadsトークンを使用しません。
公開結果の照合・復旧UI、期限切れや権限取消しからの再認証UIは未実装。
運用手順と制限はSETUP.mdを参照。

## プロンプトの即時テスト（2026-10-25更新）
新しいテスト生成はCloudflareからOpenAIへ直接依頼し、1件の結果をプロンプト画面のボタン直下と履歴に表示します。Makeの15分間隔の実行は待ちません。MakeのAIシナリオは通常投稿の生成に引き続き使用します。過去の3案テスト履歴はそのまま保持します。
## 2026-10-25：通常生成もCloudflare内で実行
AI_HISTORY_ENABLED=trueでは、既存POST /api/generation/claimが1組の通常生成を処理します。応答はjob:null, processed:true/falseとなり、既存「data.job.id Exists」フィルターで旧OpenAIモジュールと結果保存モジュールには進みません。Makeは15分ごとの起動役です。HTTPモジュール1のTimeoutを40→300秒に保存済み。既存の認証接続・スケジュールは維持。通常生成のモデル・履歴参照・類似判定・API使用量の集計はCloudflare側で統一管理します。
