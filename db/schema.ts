import {sqliteTable,text,integer,index,primaryKey,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const analysisCache=sqliteTable('analysis_cache',{key:text('key').primaryKey(),sourceUrl:text('source_url').notNull(),result:text('result').notNull(),expiresAt:integer('expires_at').notNull()});
export const processingJobs=sqliteTable('processing_jobs',{id:text('id').primaryKey(),providerId:text('provider_id').notNull(),sourceUrl:text('source_url').notNull(),expiresAt:integer('expires_at').notNull()});
export const usageCounters=sqliteTable('usage_counters',{key:text('key').primaryKey(),count:integer('count').notNull(),expiresAt:integer('expires_at').notNull()});
// Invite-link identity: a member is a name plus a device cookie. Only a hash
// of the cookie token is stored, so a database read cannot sign anyone in.
export const members=sqliteTable('members',{id:text('id').primaryKey(),displayName:text('display_name').notNull(),tokenHash:text('token_hash').notNull().unique(),createdAt:integer('created_at').notNull()});
// Product events for the closed test. Props are a small allow-listed object:
// never reel content, captions, URLs or personal data.
export const events=sqliteTable('events',{id:text('id').primaryKey(),memberId:text('member_id'),name:text('name').notNull(),bucketId:text('bucket_id'),props:text('props').notNull(),createdAt:integer('created_at').notNull()},table=>[index('events_name_created_idx').on(table.name,table.createdAt)]);
// Shared buckets (week 2). A shared bucket lives on the server so 2–6 members
// can fill it from their own phones. Personal buckets stay in the browser.
// Week 4 adds trip dates and travellers (owner-set, used to fill booking links)
// and the group's "we've agreed our shortlist" state with who and when.
export const sharedBuckets=sqliteTable('shared_buckets',{id:text('id').primaryKey(),name:text('name').notNull(),ownerMemberId:text('owner_member_id').notNull(),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),tripStart:text('trip_start'),tripEnd:text('trip_end'),travellers:integer('travellers'),shortlistAgreedBy:text('shortlist_agreed_by'),shortlistAgreedAt:integer('shortlist_agreed_at')});
export const bucketMembers=sqliteTable('bucket_members',{bucketId:text('bucket_id').notNull(),memberId:text('member_id').notNull(),role:text('role').notNull(),joinedAt:integer('joined_at').notNull()},table=>[primaryKey({columns:[table.bucketId,table.memberId]}),index('bucket_members_member_idx').on(table.memberId)]);
// Only a hash of each invite token is stored; the link itself is shown once.
export const bucketInvites=sqliteTable('bucket_invites',{id:text('id').primaryKey(),tokenHash:text('token_hash').notNull().unique(),bucketId:text('bucket_id').notNull(),createdBy:text('created_by').notNull(),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull(),revokedAt:integer('revoked_at')},table=>[index('bucket_invites_bucket_idx').on(table.bucketId)]);
// source_key is the app's reel id (canonical Instagram/TikTok key). analysis is
// a server-derived snapshot of the reel's places, so votes outlive the 1-day cache.
export const bucketReels=sqliteTable('bucket_reels',{id:text('id').primaryKey(),bucketId:text('bucket_id').notNull(),sourceKey:text('source_key').notNull(),sourceUrl:text('source_url').notNull(),addedBy:text('added_by').notNull(),addedAt:integer('added_at').notNull(),status:text('status').notNull(),jobId:text('job_id'),analysis:text('analysis'),checkedAt:integer('checked_at').notNull()},table=>[uniqueIndex('bucket_reels_source_unique').on(table.bucketId,table.sourceKey)]);
// One vote per member per place; place_key is the analysis match id.
export const placeVotes=sqliteTable('place_votes',{bucketId:text('bucket_id').notNull(),placeKey:text('place_key').notNull(),memberId:text('member_id').notNull(),value:integer('value').notNull(),updatedAt:integer('updated_at').notNull()},table=>[primaryKey({columns:[table.bucketId,table.placeKey,table.memberId]})]);
// Only provider place IDs and ReelTrip's own match data are stored. Coordinates,
// names, addresses and Maps links are fetched live, so no stored provider data
// can outlive Google's coordinate retention limit during inactivity.
// scope is 'global' for automatic matches,
// or a shared bucket id for a fix that applies to everyone in that bucket.
export const placeResolutions=sqliteTable('place_resolutions',{scope:text('scope').notNull(),placeKey:text('place_key').notNull(),status:text('status').notNull(),confidence:text('confidence').notNull(),provider:text('provider'),providerPlaceId:text('provider_place_id'),matchedAt:integer('matched_at').notNull(),verifiedAt:integer('verified_at').notNull(),fixedBy:text('fixed_by')},table=>[primaryKey({columns:[table.scope,table.placeKey]})]);
// Provider call counts per day, for cost tracking. No queries, names or places.
export const providerCalls=sqliteTable('provider_calls',{day:text('day').notNull(),provider:text('provider').notNull(),kind:text('kind').notNull(),count:integer('count').notNull()},table=>[primaryKey({columns:[table.day,table.provider,table.kind]})]);
