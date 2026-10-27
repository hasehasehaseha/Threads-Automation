select count(*) as total_posts,count(*) filter(where deleted_at is not null) as in_trash,
 (select count(*) from bulk_trash_requests) as completed_bulk_moves from posts;
