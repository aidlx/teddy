import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { Link, Stack } from 'expo-router';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export default function HomeScreen() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Teddy' }} />
      <Text style={styles.title}>Teddy</Text>
      <Text style={styles.subtitle}>Expo + Supabase + OpenAI</Text>

      {session ? (
        <>
          <Text style={styles.muted}>Signed in as {session.user.email}</Text>
          <Link href="/chat" asChild>
            <Pressable style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Open chat</Text>
            </Pressable>
          </Link>
          <Link href="/files" asChild>
            <Pressable style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Files</Text>
            </Pressable>
          </Link>
          <Pressable style={styles.ghostBtn} onPress={() => supabase.auth.signOut()}>
            <Text style={styles.muted}>Sign out</Text>
          </Pressable>
        </>
      ) : (
        <Link href="/login" asChild>
          <Pressable style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Sign in</Text>
          </Pressable>
        </Link>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0b0f',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  title: { color: '#f5f5f7', fontSize: 36, fontWeight: '600' },
  subtitle: { color: '#a1a1aa', fontSize: 14 },
  muted: { color: '#a1a1aa', fontSize: 13 },
  primaryBtn: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 200,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#000', fontWeight: '600' },
  secondaryBtn: {
    borderColor: '#3f3f46',
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 200,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#f5f5f7', fontWeight: '500' },
  ghostBtn: { marginTop: 8 },
});
