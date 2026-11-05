import {bundledApp} from './platform';
import {createSnapshotCache} from '../shared/snapshot-cache';
export const appCache=bundledApp?createSnapshotCache({storage:()=>localStorage}):null;
