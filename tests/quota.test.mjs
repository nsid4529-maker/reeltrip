import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {QUOTA_SQL} from '../lib/server/quota-sql.ts';
test('denied guest requests cannot consume global quota',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE usage_counters(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL)');
 const reserve=who=>db.prepare(QUOTA_SQL).all(who,2,'all',3,who,'all',12345);
 assert.equal(reserve('one').length,2);assert.equal(reserve('one').length,2);
 for(let i=0;i<20;i++)assert.equal(reserve('one').length,0);
 assert.equal(db.prepare("SELECT count FROM usage_counters WHERE key='all'").get().count,2);
 assert.equal(reserve('two').length,2);assert.equal(reserve('three').length,0);
 assert.equal(db.prepare("SELECT count FROM usage_counters WHERE key='two'").get().count,1);db.close();
});
