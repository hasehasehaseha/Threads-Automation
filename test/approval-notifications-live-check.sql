select jsonb_build_object(
 'settings',(select to_jsonb(s) from approval_notification_settings s where id=1),
 'deliveries',(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'status',status,'target_date',target_date,'slot',slot,'created_at',created_at,'sent_at',sent_at)),'[]') from approval_notifications),
 'posts',(select count(*) from posts),
 'published',(select count(*) from posts where status='published')
) as verification;
