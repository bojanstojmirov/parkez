import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { demo } from '../demo/demoServices';
import { formatRemaining, statusLabel } from '../domain/format';
import { findZone } from '../domain/operators';
import { ParkingSession, remainingMs } from '../domain/session';
import { SmsRequest } from '../services/smsSender';

/**
 * Everything the screen shows that lives outside React (sessions, clock, sent messages)
 * is copied into this snapshot and kept in React state. The screen renders ONLY from
 * the snapshot, so React (and React Compiler) can see when it changes.
 */
interface Snapshot {
  readonly now: number;
  readonly sessions: readonly ParkingSession[];
  readonly attempts: readonly SmsRequest[];
}

function takeSnapshot(): Snapshot {
  demo.service.refresh();
  return {
    now: demo.now(),
    sessions: demo.service.getSessions(),
    attempts: [...demo.sender.attempts],
  };
}

export default function Index() {
  const [snap, setSnap] = useState<Snapshot>(takeSnapshot);
  const refresh = () => setSnap(takeSnapshot());

  const firstOperator = demo.operators[0];
  const [operatorId, setOperatorId] = useState(firstOperator?.id ?? '');
  const [zoneCode, setZoneCode] = useState(firstOperator?.zones[0]?.code ?? '');
  const [hours, setHours] = useState(1);
  const [plate, setPlate] = useState('SK123AB');
  const [failNext, setFailNext] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Retake the snapshot every second so countdowns move and timeouts/expiry apply.
  useEffect(() => {
    const id = setInterval(() => setSnap(takeSnapshot()), 1000);
    return () => clearInterval(id);
  }, []);

  const operator = demo.operators.find((o) => o.id === operatorId);
  const zone = operator ? findZone(operator, zoneCode) : undefined;
  const isPrepaid = operator?.paymentModel === 'prepaid_hours';
  const maxHours = zone?.maxMinutes ? Math.max(1, Math.floor(zone.maxMinutes / 60)) : 4;

  function selectOperator(id: string) {
    const next = demo.operators.find((o) => o.id === id);
    setOperatorId(id);
    setZoneCode(next?.zones[0]?.code ?? '');
    setHours(1);
  }

  async function onPay() {
    setMessage(null);
    if (failNext) {
      demo.sender.queueResult({
        ok: false,
        reason: 'Simulated send failure',
        mayHaveSent: false,
      });
      setFailNext(false);
    }
    const result = await demo.service.startSession({
      operatorId,
      zoneCode,
      plate,
      hours: isPrepaid ? hours : undefined,
    });
    if (!result.ok) setMessage(result.reason);
    refresh();
  }

  function simulateConfirm(session: ParkingSession) {
    const op = demo.operators.find((o) => o.id === session.operatorId);
    const z = op ? findZone(op, session.zoneCode) : undefined;
    const minutes =
      session.requestedHours !== null ? session.requestedHours * 60 : z?.maxMinutes ?? 120;
    const result = demo.service.applyReply(
      session.id,
      `OK ${demo.now() + minutes * 60_000}`,
    );
    if (!result.ok) setMessage(result.reason);
    refresh();
  }

  function simulateReply(session: ParkingSession, text: string) {
    const result = demo.service.applyReply(session.id, text);
    if (!result.ok) setMessage(result.reason);
    refresh();
  }

  async function onStop(session: ParkingSession) {
    const result = await demo.service.stopSession(session.id);
    if (!result.ok) setMessage(result.reason);
    refresh();
  }

  function skipAhead() {
    demo.skipAhead(5 * 60_000);
    refresh();
  }

  const sessions = [...snap.sessions].reverse();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            TEST MODE: demo data, no real SMS is sent
          </Text>
        </View>

        <Text style={styles.label}>Operator</Text>
        <View style={styles.row}>
          {demo.operators.map((o) => (
            <Chip
              key={o.id}
              text={o.displayName}
              selected={o.id === operatorId}
              onPress={() => selectOperator(o.id)}
            />
          ))}
        </View>

        <Text style={styles.label}>Zone</Text>
        <View style={styles.row}>
          {operator?.zones.map((z) => (
            <Chip
              key={z.code}
              text={`${z.code} (max ${z.maxMinutes ?? '?'} min)`}
              selected={z.code === zoneCode}
              onPress={() => {
                setZoneCode(z.code);
                setHours(1);
              }}
            />
          ))}
        </View>

        <Text style={styles.label}>Licence plate</Text>
        <TextInput
          style={styles.input}
          value={plate}
          onChangeText={setPlate}
          autoCapitalize="characters"
          autoCorrect={false}
        />

        {isPrepaid && (
          <>
            <Text style={styles.label}>Hours</Text>
            <View style={styles.row}>
              <Button text="-" onPress={() => setHours((h) => Math.max(1, h - 1))} />
              <Text style={styles.hours}>{hours} h</Text>
              <Button text="+" onPress={() => setHours((h) => Math.min(maxHours, h + 1))} />
            </View>
          </>
        )}

        <View style={styles.switchRow}>
          <Text>Next SMS fails (test)</Text>
          <Switch value={failNext} onValueChange={setFailNext} />
        </View>

        <Button text="Pay by SMS (mock)" onPress={onPay} primary />
        {message !== null && <Text style={styles.error}>{message}</Text>}

        <Text style={[styles.label, styles.sectionTop]}>Sessions</Text>
        {sessions.length === 0 && <Text style={styles.muted}>No sessions yet.</Text>}
        {sessions.map((s) => {
          const left = remainingMs(s, snap.now);
          const op = demo.operators.find((o) => o.id === s.operatorId);
          return (
            <View key={s.id} style={styles.card}>
              <Text style={styles.cardTitle}>
                {s.plate} in zone {s.zoneCode}
              </Text>
              <Text style={styles.muted}>{op?.displayName}</Text>
              <Text style={styles.status}>{statusLabel(s.status)}</Text>
              {left !== null && (
                <Text style={styles.countdown}>{formatRemaining(left)} left</Text>
              )}
              {s.failureReason !== null && (
                <Text style={styles.error}>{s.failureReason}</Text>
              )}

              {(s.status === 'sms_sent' || s.status === 'unconfirmed') && (
                <>
                  <Button text="Simulate: operator confirms" onPress={() => simulateConfirm(s)} />
                  <Button
                    text="Simulate: operator rejects"
                    onPress={() => simulateReply(s, 'NO Rejected by operator')}
                  />
                </>
              )}
              {s.status === 'operator_confirmed' && op?.stopKeyword != null && (
                <Button text={`Stop early (sends ${op.stopKeyword})`} onPress={() => onStop(s)} />
              )}
              {s.status === 'stopping' && (
                <>
                  <Button
                    text="Simulate: stop confirmed"
                    onPress={() => simulateReply(s, 'STOPPED')}
                  />
                  <Button
                    text="Simulate: stop rejected"
                    onPress={() => simulateReply(s, 'NO Cannot stop')}
                  />
                </>
              )}
            </View>
          );
        })}

        <Text style={[styles.label, styles.sectionTop]}>Test tools</Text>
        <Button text="Skip ahead 5 minutes" onPress={skipAhead} />
        <Text style={styles.muted}>Messages sent so far (mock): {snap.attempts.length}</Text>
        {snap.attempts.map((a, i) => (
          <Text key={i} style={styles.muted}>
            to {a.to}: "{a.body}"
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip(props: { text: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={[styles.chip, props.selected && styles.chipSelected]}
    >
      <Text style={props.selected ? styles.chipTextSelected : undefined}>{props.text}</Text>
    </Pressable>
  );
}

function Button(props: { text: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={[styles.button, props.primary && styles.buttonPrimary]}
    >
      <Text style={props.primary ? styles.buttonTextPrimary : styles.buttonText}>
        {props.text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 8 },
  banner: { backgroundColor: '#fde68a', padding: 10, borderRadius: 8 },
  bannerText: { fontWeight: '700', textAlign: 'center' },
  label: { fontWeight: '700', marginTop: 8 },
  sectionTop: { marginTop: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { borderWidth: 1, borderColor: '#999', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  chipTextSelected: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#999', borderRadius: 8, padding: 10, fontSize: 16 },
  hours: { fontSize: 18, fontWeight: '700', minWidth: 48, textAlign: 'center' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  button: { borderWidth: 1, borderColor: '#1d4ed8', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', marginTop: 6 },
  buttonPrimary: { backgroundColor: '#1d4ed8' },
  buttonText: { color: '#1d4ed8', fontWeight: '600' },
  buttonTextPrimary: { color: '#fff', fontWeight: '700' },
  card: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 12, gap: 4, marginTop: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  status: { fontWeight: '600' },
  countdown: { fontSize: 28, fontWeight: '700' },
  muted: { color: '#666' },
  error: { color: '#b91c1c' },
});