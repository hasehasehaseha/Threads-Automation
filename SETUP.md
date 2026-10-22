# 本番用コード（配信・Supabase接続済み）

GitHub → Cloudflare Workers + Supabase。以前のSites試作とは別の配信先。

## 2026-10-22 の確認状況
- 公開先: https://danbara-threads-studio.hasegawaayato.workers.dev/
- GitHub Actionsによる配信成功。Supabaseの初期SQL適用済み。
- Supabase接続キーはCloudflare Secretに保存済み。
- 初期管理者の作成・members登録・実ブラウザーでのログインを確認。
- 「接続確認（投稿しない）」下書きの保存と「最新情報に更新」での再取得を確認。日時未指定・未承認のまま保持。
- Make・Meta・AIは未接続。自動投稿はまだ稼働していない。

## 接続後に確認する順序
1. 会社管理のGitHub非公開リポジトリに、このproductionフォルダーをルートとして登録。
2. Supabase新規プロジェクトのSQL Editorで `supabase/001_initial.sql` を一度実行。
3. 公開サインアップを無効化。Authで利用者を作成し、membersに管理者をadmin、スタッフをeditorで登録。スタッフにSupabaseの管理者権限を渡さない。
4. GitHub Actions Secret `CLOUDFLARE_API_TOKEN` に、承認済みの限定権限Cloudflareトークンを登録。Actionsの `Deploy dashboard` をmainで実行。Cloudflare標準ビルド用の広範なトークンは作成しない。
5. Cloudflareで SUPABASE_URL、SUPABASE_ANON_KEY を設定。SUPABASE_SERVICE_ROLE_KEY は必ずSecretとして登録。GitHubやブラウザーへ保存しない。
6. 管理者・スタッフ・未登録ユーザーで権限を実測。SQLの移行、競合・予約の上限、承認取消、退職者無効化を実環境で確認。
7. MakeとMeta接続、AI選定後に自動処理を実装・接続。実投稿の確認まで本番稼働とはしない。

## 実装済みのコード
- Supabase Authのメール・パスワードログイン（アクセストークンはメモリーのみ。更新・タブ再読込で再ログイン）
- activeメンバーの確認、管理者と編集者の権限
- 投稿方針の版保存、下書きCRUDのうち作成・読取・編集
- 管理者承認、取消、楽観的競合検出、承認時本文固定
- 日本時間の日単位で予約3件まで、同時刻重複不可
- 反響履歴の読取表示、未取得と0を区別
- 投稿取得を排他制御するSQL（Make向けAPIは未接続）

## 未実装・未検証
- Makeの認証付き取得/結果報告APIとシナリオ、AI生成、Meta OAuth、トークン更新、数字収集
- 公開結果の照合・復旧画面。公開処理中の再試行は自動で行わない設計
- DB定期バックアップと復元テスト、ページング、スタッフ追加UI
- 編集スタッフ・未登録ユーザーの権限確認、競合・予約上限を含む統合テスト
- 投稿時刻は個別入力。3枠の既定時刻設定は後続実装

## Make接続計画
生成、投稿、反響収集を分離。投稿は日本時間の3枠で実行。
認証付きAPIから承認済み本文とclaim_idを取得。Metaの作成・公開を実行し、投稿IDを報告する。
通信結果が不明な場合、同じ本文を再送しない。既存公開の照合後に管理者が復旧する。
数値取得はまず直近投稿を1日1回。取得日時・投稿IDを保存し、累積値を単純合算しない。

## ローカル確認
Node.js: `npm test`。開発プレビューにはWranglerのインストールと `.dev.vars` の設定が必要。
秘密情報はこの資料やチャット本文に記載しない。
