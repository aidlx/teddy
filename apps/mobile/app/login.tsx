import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { Stack, router } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';

const EMAIL_REDIRECT = Linking.createURL('/auth/callback');

type Mode = 'sign-in' | 'sign-up';

export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const headerHeight = useHeaderHeight();

  async function submit() {
    if (!email || !password) {
      Alert.alert('Missing fields', 'Enter an email and password.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace('/');
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: EMAIL_REDIRECT },
        });
        if (error) throw error;
        if (data.session) {
          router.replace('/');
        } else {
          Alert.alert(
            'Check your email',
            'Confirm your email to finish signing up, then come back and sign in.',
          );
          setMode('sign-in');
        }
      }
    } catch (err) {
      Alert.alert(mode === 'sign-in' ? 'Sign-in failed' : 'Sign-up failed', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <Stack.Screen options={{ title: mode === 'sign-in' ? 'Sign in' : 'Sign up' }} />
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{mode === 'sign-in' ? 'Sign in' : 'Create account'}</Text>

        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor="#71717a"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          editable={!busy}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#71717a"
          autoCapitalize="none"
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!busy}
        />

        <Pressable style={styles.primaryBtn} onPress={submit} disabled={busy}>
          <Text style={styles.primaryBtnText}>
            {busy ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Sign up'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
          disabled={busy}
          style={styles.switchBtn}
        >
          <Text style={styles.switchBtnText}>
            {mode === 'sign-in'
              ? "Don't have an account? Sign up"
              : 'Already have an account? Sign in'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { padding: 24, gap: 12, flexGrow: 1, justifyContent: 'center' },
  title: { color: '#f5f5f7', fontSize: 28, fontWeight: '600', marginBottom: 8 },
  input: {
    borderColor: '#3f3f46',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#f5f5f7',
    fontSize: 16,
  },
  primaryBtn: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: { color: '#000', fontWeight: '600', fontSize: 16 },
  switchBtn: { alignItems: 'center', paddingVertical: 12 },
  switchBtnText: { color: '#a1a1aa', fontSize: 14 },
});
