import { openDB } from 'idb';
import type { Recording } from './types';
const db = openDB('shengji-local', 1, { upgrade(db) { db.createObjectStore('recordings', { keyPath: 'id' }); } });
export async function listRecordings(): Promise<Recording[]> {
  return (await (await db).getAll('recordings')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function saveRecording(recording: Recording) { await (await db).put('recordings', recording); }
export async function deleteRecording(id: string) { await (await db).delete('recordings', id); }
