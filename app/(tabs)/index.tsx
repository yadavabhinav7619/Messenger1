import { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth';
import { MessageCircle, Search } from 'lucide-react-native';

interface ChatItem {
  id: string;
  user1_id: string;
  user2_id: string;
  created_at: string;
  last_message_at: string;
  is_active: boolean;
  other_user: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    is_online: boolean;
  } | null;
  last_message: string;
  last_message_type: string;
  last_message_time: string;
  unread_count: number;
}

export default function ChatListScreen() {
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const { user, profile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) return;
    fetchChats();

    const channel = supabase
      .channel('chat-list-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        () => fetchChats()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chats' },
        () => fetchChats()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  async function fetchChats() {
    if (!user) return;

    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
      .eq('is_active', true)
      .order('last_message_at', { ascending: false });

    if (error || !data) {
      setLoading(false);
      return;
    }

    const chatItems: ChatItem[] = await Promise.all(
      data.map(async (chat: any) => {
        const otherId = chat.user1_id === user.id ? chat.user2_id : chat.user1_id;

        const { data: otherProfile } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url, is_online')
          .eq('id', otherId)
          .maybeSingle();

        const { data: msgs } = await supabase
          .from('messages')
          .select('content, message_type, created_at')
          .eq('chat_id', chat.id)
          .order('created_at', { ascending: false })
          .limit(1);

        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('chat_id', chat.id)
          .eq('is_read', false)
          .neq('sender_id', user.id);

        return {
          ...chat,
          other_user: otherProfile as ChatItem['other_user'],
          last_message: msgs?.[0]?.content ?? '',
          last_message_type: msgs?.[0]?.message_type ?? 'text',
          last_message_time: msgs?.[0]?.created_at ?? chat.created_at,
          unread_count: count ?? 0,
        };
      })
    );

    setChats(chatItems);
    setLoading(false);
  }

  function formatTime(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function getLastMessagePreview(chat: ChatItem) {
    if (chat.last_message_type === 'image') return 'Photo';
    if (chat.last_message_type === 'video') return 'Video';
    if (chat.last_message_type === 'audio') return 'Voice message';
    return chat.last_message || 'No messages yet';
  }

  const filteredChats = chats.filter((chat) => {
    if (!search) return true;
    return (
      chat.other_user?.display_name?.toLowerCase().includes(search.toLowerCase()) ||
      chat.other_user?.username?.toLowerCase().includes(search.toLowerCase())
    );
  });

  function renderChatItem({ item: chat }: { item: ChatItem }) {
    const other = chat.other_user;
    if (!other) return null;

    return (
      <TouchableOpacity
        style={styles.chatItem}
        onPress={() => router.push(`/chat/${chat.id}`)}
        activeOpacity={0.7}
      >
        <View style={styles.avatarContainer}>
          {other.avatar_url ? (
            <Image source={{ uri: other.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>
                {other.display_name?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          {other.is_online && <View style={styles.onlineDot} />}
        </View>

        <View style={styles.chatInfo}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatName} numberOfLines={1}>
              {other.display_name}
            </Text>
            <Text style={styles.chatTime}>
              {chat.last_message_time ? formatTime(chat.last_message_time) : ''}
            </Text>
          </View>
          <View style={styles.chatPreviewRow}>
            <Text style={styles.chatPreview} numberOfLines={1}>
              {getLastMessagePreview(chat)}
            </Text>
            {chat.unread_count > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{chat.unread_count}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
      </View>

      <View style={styles.searchContainer}>
        <Search size={18} color="#64748b" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search conversations..."
          placeholderTextColor="#64748b"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {loading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Loading chats...</Text>
        </View>
      ) : filteredChats.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MessageCircle size={48} color="#334155" />
          <Text style={styles.emptyText}>No conversations yet</Text>
        </View>
      ) : (
        <FlatList
          data={filteredChats}
          renderItem={renderChatItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#f8fafc',
    letterSpacing: -0.5,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 14,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    fontSize: 15,
    color: '#f8fafc',
  },
  list: {
    paddingHorizontal: 20,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0ea5e9',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22c55e',
    borderWidth: 2,
    borderColor: '#0f172a',
  },
  chatInfo: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f8fafc',
    flex: 1,
    marginRight: 8,
  },
  chatTime: {
    fontSize: 12,
    color: '#64748b',
  },
  chatPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chatPreview: {
    fontSize: 14,
    color: '#94a3b8',
    flex: 1,
    marginRight: 8,
  },
  badge: {
    backgroundColor: '#0ea5e9',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  separator: {
    height: 1,
    backgroundColor: '#1e293b',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 16,
  },
});
