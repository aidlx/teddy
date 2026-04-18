import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, Pressable, Alert } from 'react-native';
import { Stack, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const REDIRECT = Linking.createURL('/auth/callback');

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  async function signInWithEmail() {
    if (!email) return;
    setStatus('sending');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: REDIRECT },
    });
    if (error) {
      Alert.alert('Sign-in failed', error.message);
      setStatus('idle');
      return;
    }
    setStatus('sent');
  }

  async function signInWithProvider(provider: 'google' | 'apple') {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: REDIRECT, skipBrowserRedirect: true },
    });
    if (error || !data.url) {
      Alert.alert('Sign-in failed', error?.message ?? 'Unknown error');
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT);
    if (result.type === 'success' && result.url) {
      const { params } = Linking.parse(result.url);
      const code = typeof params.code === 'string' ? params.code : undefined;
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
        router.replace('/');
      }
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Sign in' }} />
      <Text style={styles.title}>Sign in</Text>

      <Pressable style={styles.providerBtn} onPress={() => signInWithProvider('google')}>
        <Text style={styles.providerBtnText}>Continue with Google</Text>
      </Pressable>
      <Pressable style={styles.providerBtn} onPress={() => signInWithProvider('apple')}>
        <Text style={styles.providerBtnText}>Continue with Apple</Text>
      </Pressable>

      <Text style={styles.divider}>or</Text>

      <TextInput
        style={styles.input}
        placeholder="you@example.com"
        placeholderTextColor="#71717a"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Pressable style={styles.primaryBtn} onPress={signInWithEmail} disabled={status === 'sending'}>
        <Text style={styles.primaryBtnText}>
          {status === 'sending' ? 'Sending…' : 'Send magic link'}
        </Text>
      </Pressable>
      {status === 'sent' && (
        <Text style={styles.success}>Check your inbox for the sign-in link.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f', padding: 24, gap: 12, justifyContent: 'center' },
  title: { color: '#f5f5f7', fontSize: 28, fontWeight: '600', marginBottom: 8 },
  providerBtn: {
    borderColor: '#3f3f46',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  providerBtnText: { color: '#f5f5f7', fontWeight: '500' },
  divider: { color: '#71717a', textAlign: 'center', marginVertical: 8 },
  input: {
    borderColor: '#3f3f46',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f5f5f7',
  },
  primaryBtn: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#000', fontWeight: '600' },
  success: { color: '#34d399', marginTop: 4 },
});
