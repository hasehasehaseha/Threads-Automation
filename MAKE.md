# Make接続の作業状況

2026-10-22: https://eu2.make.com/556148/scenarios/10021080/edit

- 「段原 Threads｜承認済み投稿の配信」を保存。Inactiveのまま。
- 現在はHTTP GET /api/configの疎通確認のみ。Run once成功。
- 投稿希望時刻はユーザー指定で Asia/Tokyo の08:00 / 12:00 / 20:00。
- シナリオの現在の表示は初期値Every 15 minutes。投稿スケジュールはまだ未設定。
- Metaアプリは未作成。Metaログインをユーザーへ依頼済み。

## 実装済み・未配信の専用API

新しいMAKE_API_TOKENをCloudflare SecretとMakeのHTTP接続認証に保存する。
Supabase service_roleキーはMakeには渡さない。
保存前に対象・権限を示してユーザーの承認を得る。トークンは32文字以上のランダム値。

- POST /api/automation/claim: 承認済みで期限内の1件だけを排他取得。対象なしはpost:null。
- POST /api/automation/result: id / claim_id / status / meta_post_idを送信。
- statusはpublishedまたはneeds_review。公開結果不明はneeds_reviewにして再投稿しない。
- 同じclaimの同じ結果は冪等。別claimや公開済みの上書きは拒否。
- 認証はAuthorization: Bearer。AUTOMATION_ENABLED=trueを明示しない限り停止。
- supabase/002_automation_result.sqlはまだ未適用。src/worker.jsも未配信。

次はSQL適用・配信・専用接続認証の登録・Meta接続・シナリオの配信処理追加。
Makeの自動再実行を公開操作に適用しない。公開が成功した可能性があるエラーは必ず照合する。
生成と反響収集は未実装。現段階で本番自動投稿は有効にしない。
