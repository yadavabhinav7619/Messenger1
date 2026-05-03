import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth';
import { sendMediaMessage } from '@/lib/media';
import {
  Send,
  ArrowLeft,
  Mic,
  MicOff,
  Paperclip,
  Play,
  Check,
  CheckCheck,
  Trash2,
} from 'lucide-react-native';

interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string | null;
  message_type: 'text' | 'image' | 'video' | 'audio';
  media_url: string | null;
  created_at: string;
  is_read: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
}

interface OtherUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_online: boolean;
}

export default function ChatScreen() {
  const { id: chatId } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [otherUser, setOtherUser] = useState<OtherUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const { user, profile, isAdmin } = useAuth();
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!chatId || !user) return;
    fetchMessages();
    fetchChatInfo();

    // Admin: mark messages as seen (sets delete_after = now + 24h)
    // But do NOT mark is_read on user-facing messages (invisible monitoring)
    if (isAdmin) {
      markAdminSeen();
    } else {
      markAsRead();
    }

    const channel = supabase
      .channel(`chat-${chatId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            const msg = payload.new as Message;
            // Hide deleted messages from user view
            if (!isAdmin && msg.is_deleted) return prev;
            return [...prev, msg];
          });
          // Admin: mark seen silently, no read receipt
          if (isAdmin) {
            markAdminSeen();
          } else {
            markAsRead();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === payload.new.id) {
                const updated = payload.new as Message;
                // If user deleted, remove from user view
                if (!isAdmin && updated.is_deleted) return { ...updated, content: null, media_url: null };
                return updated;
              }
              return m;
            })
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, [chatId, user?.id, isAdmin]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  async function fetchMessages() {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (!error && data) {
      // For non-admin users, filter out deleted messages
      const filtered = isAdmin
        ? (data as Message[])
        : (data as Message[]).filter((m) => !m.is_deleted);
      setMessages(filtered);
    }
    setLoading(false);
  }

  async function fetchChatInfo() {
    const { data: chat } = await supabase
      .from('chats')
      .select('*')
      .eq('id', chatId)
      .maybeSingle();

    if (chat && profile) {
      const chatData = chat as any;
      const otherId = chatData.user1_id === profile.id ? chatData.user2_id : chatData.user1_id;
      const { data: otherProfile } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, is_online')
        .eq('id', otherId)
        .maybeSingle();
      setOtherUser(otherProfile as OtherUser | null);
    }
  }

  // User-side read receipt (admin is invisible - never triggers this)
  async function markAsRead() {
    if (!user || isAdmin) return;
    await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('chat_id', chatId)
      .neq('sender_id', user.id)
      .eq('is_read', false);
  }

  // Admin invisible monitoring: mark admin_messages as seen + set delete_after
  async function markAdminSeen() {
    if (!isAdmin) return;
    try {
      await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/admin-seen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ chat_id: chatId }),
      });
    } catch {
      // Silently fail - admin monitoring should not disrupt UX
    }
  }

  async function sendMessage() {
    if (!newMessage.trim() || !user || sending) return;
    setSending(true);

    // Dual-write is handled by database trigger automatically
    const { error } = await supabase.from('messages').insert({
      chat_id: chatId,
      sender_id: user.id,
      content: newMessage.trim(),
      message_type: 'text',
    });

    if (!error) {
      setNewMessage('');
      // Trigger notification for the other user
      await notifyOtherUser();
    }
    setSending(false);
  }

  // User delete: soft-delete from messages table only (admin copy stays safe)
  async function deleteMessage(messageId: string) {
    Alert.alert('Delete Message', 'Delete this message? It will be removed from your view.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase
            .from('messages')
            .update({ is_deleted: true, deleted_at: new Date().toISOString() })
            .eq('id', messageId);
          // The trigger syncs is_deleted_by_user to admin_messages automatically
          setMessages((prev) =>
            isAdmin
              ? prev.map((m) => m.id === messageId ? { ...m, is_deleted: true } : m)
              : prev.filter((m) => m.id !== messageId)
          );
        },
      },
    ]);
  }

  // Voice recording (web platform)
  function startRecording() {
    if (Platform.OS !== 'web') return;

    try {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const file = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
          await sendMediaMessage(chatId, user!.id, file, 'audio');
          stream.getTracks().forEach((t) => t.stop());
          setIsRecording(false);
          setRecordingDuration(0);
        };

        mediaRecorder.start();
        setIsRecording(true);
        setRecordingDuration(0);
        recordingTimerRef.current = setInterval(() => {
          setRecordingDuration((d) => d + 1);
        }, 1000);
      });
    } catch {
      Alert.alert('Error', 'Microphone access denied');
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  }

  function handleFileUpload() {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*,audio/*';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file || !user) return;

        const type = file.type.startsWith('image/')
          ? 'image' as const
          : file.type.startsWith('video/')
          ? 'video' as const
          : 'audio' as const;

        await sendMediaMessage(chatId, user.id, file, type);
        await notifyOtherUser();
      };
      input.click();
    }
  }

  async function notifyOtherUser() {
    if (!otherUser || !otherUser.id) return;
    try {
      await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({
          user_id: otherUser.id,
          title: profile?.display_name || 'New Message',
          body: newMessage || 'Sent you a message',
          data: { chat_id: chatId, type: 'new_message' },
        }),
      });
    } catch {
      // Notification failure should not block messaging
    }
  }

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatDuration(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function renderMessage({ item: msg }: { item: Message }) {
    const isMe = msg.sender_id === user?.id;
    const isImage = msg.message_type === 'image';
    const isVideo = msg.message_type === 'video';
    const isAudio = msg.message_type === 'audio';

    // Show deleted placeholder for admin view
    if (msg.is_deleted && isAdmin) {
      return (
        <View style={[styles.messageRow, isMe ? styles.messageRowRight : styles.messageRowLeft]}>
          <View style={[styles.messageBubble, styles.deletedMessage]}>
            <Text style={styles.deletedText}>Message deleted by user</Text>
          </View>
        </View>
      );
    }

    return (
      <TouchableOpacity
        onLongPress={() => {
          if (isMe) deleteMessage(msg.id);
        }}
        delayLongPress={500}
        activeOpacity={0.9}
      >
        <View style={[styles.messageRow, isMe ? styles.messageRowRight : styles.messageRowLeft]}>
          {!isMe && isAdmin && (
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>ADMIN VIEW</Text>
            </View>
          )}
          <View
            style={[
              styles.messageBubble,
              isMe ? styles.myMessage : styles.theirMessage,
              isImage && styles.mediaBubble,
            ]}
          >
            {isImage && msg.media_url && (
              <Image source={{ uri: msg.media_url }} style={styles.messageImage} resizeMode="cover" />
            )}
            {isVideo && msg.media_url && (
              <View style={styles.mediaPlaceholder}>
                <Play size={24} color="#fff" />
                <Text style={styles.mediaLabel}>Video</Text>
              </View>
            )}
            {isAudio && msg.media_url && (
              <TouchableOpacity style={styles.audioMessage}>
                <Play size={20} color={isMe ? '#fff' : '#0ea5e9'} />
                <View style={styles.audioWaveform}>
                  <View style={[styles.audioBar, { backgroundColor: isMe ? 'rgba(255,255,255,0.5)' : '#334155' }]} />
                  <View style={[styles.audioBar, styles.audioBarTall, { backgroundColor: isMe ? 'rgba(255,255,255,0.7)' : '#0ea5e9' }]} />
                  <View style={[styles.audioBar, { backgroundColor: isMe ? 'rgba(255,255,255,0.5)' : '#334155' }]} />
                  <View style={[styles.audioBar, styles.audioBarTall, { backgroundColor: isMe ? 'rgba(255,255,255,0.7)' : '#0ea5e9' }]} />
                  <View style={[styles.audioBar, { backgroundColor: isMe ? 'rgba(255,255,255,0.5)' : '#334155' }]} />
                </View>
                <Text style={[styles.audioDuration, isMe ? styles.myMessageTime : styles.theirMessageTime]}>
                  0:00
                </Text>
              </TouchableOpacity>
            )}
            {msg.content && (
              <Text style={[styles.messageText, isMe ? styles.myMessageText : styles.theirMessageText]}>
                {msg.content}
              </Text>
            )}
            <View style={styles.messageMeta}>
              <Text style={[styles.messageTime, isMe ? styles.myMessageTime : styles.theirMessageTime]}>
                {formatTime(msg.created_at)}
              </Text>
              {isMe && !isAdmin && (
                msg.is_read ? (
                  <CheckCheck size={14} color="#0ea5e9" />
                ) : (
                  <Check size={14} color="#64748b" />
                )
              )}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  function renderDateSeparator(date: string) {
    const d = new Date(date);
    const today = new Date();
    const diff = Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

    let label: string;
    if (diff === 0) label = 'Today';
    else if (diff === 1) label = 'Yesterday';
    else label = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

    return (
      <View style={styles.dateSeparator}>
        <View style={styles.dateLine} />
        <Text style={styles.dateText}>{label}</Text>
        <View style={styles.dateLine} />
      </View>
    );
  }

  function renderMessageWithDate({ item, index }: { item: Message; index: number }) {
    const showDate =
      index === 0 ||
      (index > 0 &&
        new Date(item.created_at).toDateString() !==
          new Date(messages[index - 1].created_at).toDateString());

    return (
      <View>
        {showDate && renderDateSeparator(item.created_at)}
        {renderMessage({ item })}
      </View>
    );
  }

  const session = useAuth().session;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: otherUser?.display_name || 'Chat',
          headerStyle: { backgroundColor: '#1e293b' },
          headerTintColor: '#f8fafc',
          headerTitleStyle: { fontWeight: '600' },
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
              <ArrowLeft size={24} color="#f8fafc" />
            </TouchableOpacity>
          ),
        }}
      />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0ea5e9" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessageWithDate}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
        />
      )}

      {isRecording ? (
        <View style={styles.recordingBar}>
          <View style={styles.recordingIndicator}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>
              Recording {formatDuration(recordingDuration)}
            </Text>
          </View>
          <TouchableOpacity style={styles.stopButton} onPress={stopRecording}>
            <MicOff size={20} color="#fff" />
            <Text style={styles.stopButtonText}>Stop</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.inputContainer}>
          <TouchableOpacity style={styles.attachButton} onPress={handleFileUpload}>
            <Paperclip size={22} color="#64748b" />
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor="#64748b"
            value={newMessage}
            onChangeText={setNewMessage}
            multiline
            maxLength={2000}
          />

          {Platform.OS === 'web' && !newMessage.trim() && (
            <TouchableOpacity style={styles.micButton} onPress={startRecording}>
              <Mic size={20} color="#64748b" />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.sendButton, !newMessage.trim() && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!newMessage.trim() || sending}
          >
            <Send size={20} color={newMessage.trim() ? '#fff' : '#64748b'} />
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 8,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 6,
    alignItems: 'flex-end',
  },
  messageRowLeft: {
    justifyContent: 'flex-start',
  },
  messageRowRight: {
    justifyContent: 'flex-end',
  },
  adminBadge: {
    backgroundColor: '#f59e0b',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginRight: 6,
    marginBottom: 4,
  },
  adminBadgeText: {
    color: '#0f172a',
    fontSize: 8,
    fontWeight: '700',
  },
  messageBubble: {
    maxWidth: '75%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  myMessage: {
    backgroundColor: '#0ea5e9',
    borderBottomRightRadius: 4,
  },
  theirMessage: {
    backgroundColor: '#1e293b',
    borderBottomLeftRadius: 4,
  },
  deletedMessage: {
    backgroundColor: '#1e293b',
    borderBottomLeftRadius: 4,
    opacity: 0.5,
  },
  deletedText: {
    color: '#64748b',
    fontSize: 13,
    fontStyle: 'italic',
  },
  mediaBubble: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  myMessageText: {
    color: '#fff',
  },
  theirMessageText: {
    color: '#e2e8f0',
  },
  messageImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
  },
  mediaPlaceholder: {
    width: 200,
    height: 80,
    borderRadius: 12,
    backgroundColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  mediaLabel: {
    color: '#94a3b8',
    fontSize: 12,
  },
  audioMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  audioWaveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flex: 1,
  },
  audioBar: {
    width: 3,
    height: 16,
    borderRadius: 2,
  },
  audioBarTall: {
    height: 24,
  },
  audioDuration: {
    fontSize: 11,
  },
  messageMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    justifyContent: 'flex-end',
  },
  messageTime: {
    fontSize: 11,
  },
  myMessageTime: {
    color: 'rgba(255,255,255,0.7)',
  },
  theirMessageTime: {
    color: '#64748b',
  },
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    gap: 8,
  },
  dateLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1e293b',
  },
  dateText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '500',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#1e293b',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    gap: 8,
  },
  attachButton: {
    padding: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#f8fafc',
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#334155',
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0ea5e9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#1e293b',
  },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1e293b',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
  recordingText: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '500',
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ef4444',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
