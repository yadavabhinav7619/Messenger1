import { supabase } from './supabase';

export async function uploadMedia(
  file: File,
  userId: string,
  type: 'image' | 'video' | 'audio'
): Promise<{ url: string | null; error: string | null }> {
  const ext = file.name.split('.').pop() || 'bin';
  const timestamp = Date.now();
  const path = `${userId}/${type}_${timestamp}.${ext}`;

  const { error } = await supabase.storage
    .from('chat-media')
    .upload(path, file, { cacheControl: '3600', upsert: false });

  if (error) {
    return { url: null, error: error.message };
  }

  const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(path);
  return { url: urlData.publicUrl, error: null };
}

export async function sendMediaMessage(
  chatId: string,
  senderId: string,
  file: File,
  type: 'image' | 'video' | 'audio'
) {
  const { url, error: uploadError } = await uploadMedia(file, senderId, type);
  if (uploadError || !url) {
    return { error: uploadError || 'Upload failed' };
  }

  const { error } = await supabase.from('messages').insert({
    chat_id: chatId,
    sender_id: senderId,
    message_type: type,
    media_url: url,
    content: null,
  });

  return { error: error?.message || null };
}
