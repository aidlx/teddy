import { useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View, Pressable, Alert } from 'react-native';
import { Stack } from 'expo-router';
import type { ChatMessage } from '@teddy/shared';
import { supabase } from '@/lib/supabase';
import { sendChat } from '@/lib/api';

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    if (!input.trim() || sending) return;
    const userMsg: ChatMessage = { role: 'user', content: input };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setSending(true);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      Alert.alert('Not signed in');
      setSending(false);
      return;
    }

    try {
      const reply = await sendChat(next, token);
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (err) {
      Alert.alert('Chat failed', (err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Chat' }} />
      <FlatList
        data={messages}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === 'user' ? styles.user : styles.assistant]}>
            <Text style={item.role === 'user' ? styles.userText : styles.assistantText}>
              {item.content}
            </Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.muted}>Send a message to start.</Text>}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message…"
          placeholderTextColor="#71717a"
          editable={!sending}
        />
        <Pressable style={styles.sendBtn} onPress={send} disabled={sending}>
          <Text style={styles.sendBtnText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  list: { padding: 16, gap: 8, flexGrow: 1 },
  muted: { color: '#71717a', textAlign: 'center', marginTop: 32 },
  bubble: { padding: 10, borderRadius: 8, maxWidth: '85%' },
  user: { alignSelf: 'flex-end', backgroundColor: '#fff' },
  assistant: { alignSelf: 'flex-start', backgroundColor: '#18181b' },
  userText: { color: '#000' },
  assistantText: { color: '#f5f5f7' },
  inputRow: { flexDirection: 'row', padding: 12, gap: 8, borderTopColor: '#27272a', borderTopWidth: 1 },
  input: {
    flex: 1,
    borderColor: '#3f3f46',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#f5f5f7',
  },
  sendBtn: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  sendBtnText: { color: '#000', fontWeight: '600' },
});
