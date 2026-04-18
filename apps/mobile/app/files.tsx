import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View, Pressable, Alert } from 'react-native';
import { Stack } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { supabase } from '@/lib/supabase';

interface FileRow {
  id: string;
  name: string;
  size: number;
  storage_path: string;
  created_at: string;
}

export default function FilesScreen() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    void loadFiles();
  }, []);

  async function loadFiles() {
    const { data, error } = await supabase
      .from('files')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) Alert.alert('Load failed', error.message);
    else setFiles(data ?? []);
  }

  async function pickAndUpload() {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];

    setUploading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

      const path = `${user.id}/${Date.now()}-${asset.name}`;
      const { error: uploadError } = await supabase.storage
        .from('user-files')
        .upload(path, bytes, { contentType: asset.mimeType ?? 'application/octet-stream' });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from('files').insert({
        owner_id: user.id,
        name: asset.name,
        mime_type: asset.mimeType ?? 'application/octet-stream',
        size: asset.size ?? 0,
        storage_path: path,
      });
      if (insertError) throw insertError;

      await loadFiles();
    } catch (err) {
      Alert.alert('Upload failed', (err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Files' }} />
      <Pressable style={styles.uploadBtn} onPress={pickAndUpload} disabled={uploading}>
        <Text style={styles.uploadBtnText}>{uploading ? 'Uploading…' : 'Upload file'}</Text>
      </Pressable>
      <FlatList
        data={files}
        keyExtractor={(f) => f.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.size}>{(item.size / 1024).toFixed(1)} KB</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.muted}>No files yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  uploadBtn: { backgroundColor: '#fff', margin: 16, padding: 12, borderRadius: 8, alignItems: 'center' },
  uploadBtnText: { color: '#000', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomColor: '#27272a',
    borderBottomWidth: 1,
  },
  name: { color: '#f5f5f7' },
  size: { color: '#71717a' },
  muted: { color: '#71717a', textAlign: 'center', marginTop: 32 },
});
