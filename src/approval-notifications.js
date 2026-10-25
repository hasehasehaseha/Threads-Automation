export function notificationEmail(n){
 const test=n.kind==='test',title=(test?'【接続テスト】':'【要承認】')+'Threads Studio '+n.target_date+'の投稿確認';
 const text=(test?'これは通知メールの接続テストです。実際の承認状況にかかわらず送信しています。':'明日（'+n.target_date+'）の承認済み・予約が有効な投稿が0件です。このままでは明日の自動投稿が行われません。下書きがない場合は生成・作成も必要です。')+'\n\nThreads Studioで確認・承認してください。\nhttps://danbara-threads-studio.hasegawaayato.workers.dev/\n\n'+(test?'通常通知は前日の12:00、18:00（日本時間）に、それぞれ承認済みが0件の場合のみ送信します。':n.slot+'時（日本時間）の確認。1件でも有効な予約があれば通知しません。')+'\nこのメールへの返信では承認されません。';
 return {id:n.id,claim_id:n.claim_id,to:n.recipient,subject:title,text};
}
export function notificationSettings(data){
 if(typeof data.enabled!=='boolean'||!Number.isInteger(data.version)||typeof data.recipient!=='string'||data.recipient.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.recipient))throw new Error('通知設定・メールアドレスを確認してください。');
 const dates=Array.isArray(data.skip_dates)?data.skip_dates:[];
 if(dates.length>100||dates.some(d=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d))throw new Error('通知しない投稿日はYYYY-MM-DD形式で入力してください。');
 return {p_version:data.version,p_enabled:data.enabled,p_recipient:data.recipient,p_skip:[...new Set(dates)]};
}
