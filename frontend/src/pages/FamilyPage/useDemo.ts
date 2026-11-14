// The demo buttons' state, kept on the page rather than in the panel, so a
// drill on its way survives the panel moving (one column or two).
//
// Surprise drill: by default it goes to someone whose phone page is open, so
// it rings where people are looking; "Anyone" lets the back end choose at
// random among everyone who can get one. While a drill is on its way or on
// the call, the button waits, so a second click never books a second call.
// Shield demo call: rings now, then the page moves to the live call.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { CallStatus, MemberView, ProtectionView } from '../../api/types';
import { callErrorText } from './words';

export const ANYONE = '';

export type Drill = {
  callId: string;
  name: string;
  status: CallStatus | 'scheduled';
  /** When the back end will ring it (ISO), for the countdown while it is on its way. */
  scheduledFor: string | null;
};

const LIVE: Drill['status'][] = ['scheduled', 'ringing', 'in_progress'];

/** Someone who can get a drill, phone open, not the organiser if anyone else is. */
function pickOpen(members: MemberView[], canGet: (id: string) => boolean): string {
  const open = members.filter((member) => canGet(member.id) && member.phone_online);
  return (open.find((member) => !member.is_organiser) ?? open[0])?.id ?? ANYONE;
}

/** The first choice for the Shield demo: someone who agreed, with their phone open, not the organiser. */
function firstShieldPick(members: MemberView[]): string {
  const pool = members.filter((member) => member.consent.practice);
  return (
    pool.find((member) => !member.is_organiser && member.phone_online)?.id ??
    pool.find((member) => member.phone_online)?.id ??
    pool.find((member) => !member.is_organiser)?.id ??
    pool[0]?.id ??
    ''
  );
}

export function useDemo(familyId: string, members: MemberView[], protection: ProtectionView | null) {
  const navigate = useNavigate();
  const knowsEligibility = protection !== null;
  const eligibleIds = new Set(protection?.members.filter((member) => member.eligible).map((member) => member.member_id));
  const canGet = (id: string) => !knowsEligibility || eligibleIds.has(id);
  const reasonFor = (id: string) => protection?.members.find((member) => member.member_id === id)?.reason_if_not ?? null;

  // ---------------------------------------------------------------- surprise drill

  // null until the organiser chooses: the choice then follows whose phone is open.
  const [drillChosen, setDrillChosen] = useState<string | null>(null);
  const autoPick = pickOpen(members, canGet);
  const chosenStillThere = drillChosen === ANYONE || members.some((member) => member.id === drillChosen);
  const drillFor = drillChosen !== null && chosenStillThere ? drillChosen : autoPick;
  const drillTarget = members.find((member) => member.id === drillFor);

  const [drillBusy, setDrillBusy] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [shieldChosen, setShieldChosen] = useState('');

  // Another family: start again.
  useEffect(() => {
    setDrillChosen(null);
    setDrill(null);
    setShieldChosen('');
  }, [familyId]);

  // Follow the drill until it is over: it is planned, then rings, then is answered.
  const drillId = drill?.callId;
  const drillLive = drill !== null && LIVE.includes(drill.status);
  useEffect(() => {
    if (!drillId || !drillLive) return;
    let live = true;
    const check = async () => {
      try {
        const call = await api.getCall(drillId);
        if (live) setDrill((current) => (current && current.callId === drillId ? { ...current, status: call.status } : current));
      } catch {
        // the next check tries again
      }
    };
    const timer = window.setInterval(() => void check(), 2000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [drillId, drillLive]);

  // An error goes once what it was about changes: the person chosen, or a new drill on its way.
  useEffect(() => setDrillError(null), [drillFor, drillId]);

  const surprise = async () => {
    if (drillBusy || drillLive) return;
    setDrillBusy(true);
    setDrillError(null);
    try {
      const created = await api.surpriseDrill(familyId, { member_id: drillFor || null, within_seconds: 60 });
      setDrill({
        callId: created.call_id,
        name: created.member.name,
        status: 'scheduled',
        scheduledFor: created.scheduled_for,
      });
    } catch (error) {
      setDrillError(callErrorText(error, drillTarget?.name ?? 'This person'));
    } finally {
      setDrillBusy(false);
    }
  };

  // ---------------------------------------------------------------- shield demo

  const shieldFor =members.some((member) => member.id === shieldChosen) ? shieldChosen : firstShieldPick(members);
  const shieldTarget = members.find((member) => member.id === shieldFor);
  const [shieldBusy, setShieldBusy] = useState(false);
  const [shieldError, setShieldError] = useState<string | null>(null);
  const targetOnline = shieldTarget?.phone_online;
  useEffect(() => setShieldError(null), [shieldFor, targetOnline]);

  const shield = async () => {
    if (!shieldTarget) return;
    setShieldBusy(true);
    setShieldError(null);
    try {
      const created = await api.shieldCall(familyId, { member_id: shieldTarget.id });
      navigate(`/calls/${created.call_id}`);
    } catch (error) {
      setShieldError(callErrorText(error, shieldTarget.name));
      setShieldBusy(false);
    }
  };

  return {
    canGet,
    reasonFor,
    drill: {
      choice: drillFor,
      choose: setDrillChosen,
      target: drillTarget,
      busy: drillBusy,
      error: drillError,
      current: drill,
      live: drillLive,
      start: surprise,
    },
    shield: {
      choice: shieldFor,
      choose: setShieldChosen,
      target: shieldTarget,
      busy: shieldBusy,
      error: shieldError,
      start: shield,
    },
  };
}

export type Demo = ReturnType<typeof useDemo>;
