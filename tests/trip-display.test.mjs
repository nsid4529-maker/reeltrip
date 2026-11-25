import test from 'node:test';
import assert from 'node:assert/strict';
import {tripDateLabel} from '../lib/trip-display.ts';

test('trip cards display undecided and partial dates without inventing a range',()=>{
 assert.equal(tripDateLabel({start:'',end:''}),'Dates to decide');
 assert.equal(tripDateLabel({start:'2027-01-10',end:''}),'From 10 Jan 2027 · departure to decide');
 assert.equal(tripDateLabel({start:'',end:'2027-01-18'}),'Until 18 Jan 2027 · arrival to decide');
});

test('trip card dates retain calendar days and years, including unfinished date edits',()=>{
 assert.equal(tripDateLabel({start:'2026-12-30',end:'2027-01-03'}),'30 Dec 2026 – 3 Jan 2027');
 assert.equal(tripDateLabel({start:'2027-01-18',end:'2027-01-10'}),'18 Jan 2027 – 10 Jan 2027');
});
