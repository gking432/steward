import { createEmptyState } from '../../lib/initial-state';
import { StewardApp } from '../steward/app';
export default function Manual() { const state=createEmptyState('My plan','');state.profile.takeHomePay=0;state.profile.nextPayday=new Date().toISOString().slice(0,10);return <StewardApp initialState={state} syncWithServer={false} manualMode/>; }
