import { useEffect } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function AuthCallback() {
  const params = useLocalSearchParams<{ code?: string }>();

  useEffect(() => {
    async function handle() {
      if (params.code) {
        await supabase.auth.exchangeCodeForSession(params.code);
      }
      router.replace('/');
    }
    void handle();
  }, [params.code]);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Completing sign-in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f', alignItems: 'center', justifyContent: 'center' },
  text: { color: '#f5f5f7' },
});
