import { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth';
import {
  Shield,
  Users,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  Eye,
  EyeOff,
  UserPlus,
  Clock,
  Archive,
  Play,
  Mic,
} from 'lucide-react-native';

interface ProfileItem {
  id: string;
  username: string;
  display_name: string;
  role: 'user' | 'admin';
  avatar_url: string | null;
  created_at: string;
  is_online: boolean;
  last_seen: string;
}

interface ChatAdminItem {
  id: string;
  user1_id: string;
  user2_id: string;
  created_at: string;
  last_message_at: string;
  is_active: boolean;
  user1: { id: string; username: string; display_name: string } | null;
  user2: { id: string; username: string; display_name: string } | null;
  unseen_count: number;
}

interface AdminMessage {
  id: string;
  original_message_id: string | null;
  chat_id: string;
  sender_id: string;
  content: string | null;
  message_type: 'text' | 'image' | 'video' | 'audio';
  media_url: string | null;
  created_at: string;
  admin_seen_at: string | null;
  delete_after: string | null;
  is_deleted_by_user: boolean;
  sender_name: string;
}

export default function AdminScreen() {
  const [activeTab, setActiveTab] = useState<'users' | 'chats' | 'create' | 'archive'>('users');
  const [users, setUsers] = useState<ProfileItem[]>([]);
  const [chats, setChats] = useState<ChatAdminItem[]>([]);
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [searchUser, setSearchUser] = useState('');
  const [loading, setLoading] = useState(true);
  const [newChatUser1, setNewChatUser1] = useState('');
  const [newChatUser2, setNewChatUser2] = useState('');
  const { profile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (profile?.role !== 'admin') return;
    if (activeTab === 'users') fetchUsers();
    else if (activeTab === 'chats') fetchAllChats();
    else if (activeTab === 'archive') fetchAdminArchive();
  }, [activeTab, profile?.role]);

  async function fetchUsers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setUsers(data as ProfileItem[]);
    setLoading(false);
  }

  async function fetchAllChats() {
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .order('last_message_at', { ascending: false });

    if (error || !data) {
      setLoading(false);
      return;
    }

    const chatItems: ChatAdminItem[] = await Promise.all(
      (data as any[]).map(async (chat: any) => {
        const { data: u1 } = await supabase
          .from('profiles')
          .select('id, username, display_name')
          .eq('id', chat.user1_id)
          .maybeSingle();

        const { data: u2 } = await supabase
          .from('profiles')
          .select('id, username, display_name')
          .eq('id', chat.user2_id)
          .maybeSingle();

        // Count unseen admin_messages for this chat
        const { count } = await supabase
          .from('admin_messages')
          .select('*', { count: 'exact', head: true })
          .eq('chat_id', chat.id)
          .is('admin_seen_at', null);

        return {
          ...chat,
          user1: u1 as ChatAdminItem['user1'],
          user2: u2 as ChatAdminItem['user2'],
          unseen_count: count ?? 0,
        };
      })
    );

    setChats(chatItems);
    setLoading(false);
  }

  async function fetchAdminArchive(chatId?: string | null) {
    let query = supabase
      .from('admin_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (chatId) {
      query = query.eq('chat_id', chatId);
    }

    const { data, error } = await query;

    if (error || !data) {
      setLoading(false);
      return;
    }

    // Enrich with sender names
    const enriched: AdminMessage[] = await Promise.all(
      (data as any[]).map(async (msg: any) => {
        const { data: sender } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', msg.sender_id)
          .maybeSingle();

        return {
          ...msg,
          sender_name: (sender as any)?.display_name || 'Unknown',
        };
      })
    );

    setAdminMessages(enriched);
    setLoading(false);
  }

  async function createChat() {
    if (!newChatUser1.trim() || !newChatUser2.trim()) {
      Alert.alert('Error', 'Please enter both usernames');
      return;
    }

    const { data: user1Profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', newChatUser1.trim())
      .maybeSingle();

    const { data: user2Profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', newChatUser2.trim())
      .maybeSingle();

    if (!user1Profile || !user2Profile) {
      Alert.alert('Error', 'One or both usernames not found');
      return;
    }

    const ids = [(user1Profile as any).id, (user2Profile as any).id].sort();
    const { error } = await supabase.from('chats').insert({
      user1_id: ids[0],
      user2_id: ids[1],
    });

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Success', 'Chat created successfully');
      setNewChatUser1('');
      setNewChatUser2('');
      setActiveTab('chats');
      setLoading(true);
      fetchAllChats();
    }
  }

  async function deactivateChat(chatId: string) {
    Alert.alert('Deactivate Chat', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deactivate',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('chats').update({ is_active: false }).eq('id', chatId);
          setLoading(true);
          fetchAllChats();
        },
      },
    ]);
  }

  // Admin views a chat invisibly - opens the chat screen but no read receipts
  function openChatInvisible(chatId: string) {
    router.push(`/chat/${chatId}`);
  }

  // View admin archive for a specific chat
  function viewArchive(chatId: string) {
    setSelectedChatId(chatId);
    setLoading(true);
    fetchAdminArchive(chatId);
  }

  const filteredUsers = users.filter(
    (u) =>
      !searchUser ||
      u.username.toLowerCase().includes(searchUser.toLowerCase()) ||
      u.display_name.toLowerCase().includes(searchUser.toLowerCase())
  );

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function renderUserItem({ item: user }: { item: ProfileItem }) {
    return (
      <View style={styles.userItem}>
        <View style={styles.userInfo}>
          <View style={styles.userAvatar}>
            <Text style={styles.userAvatarText}>
              {user.display_name?.charAt(0)?.toUpperCase() || '?'}
            </Text>
          </View>
          <View style={styles.userDetails}>
            <Text style={styles.userName}>{user.display_name}</Text>
            <Text style={styles.userUsername}>@{user.username}</Text>
          </View>
        </View>
        <View
          style={[
            styles.roleBadge,
            user.role === 'admin' ? styles.adminBadgeStyle : styles.userBadgeStyle,
          ]}
        >
          <Text style={[styles.roleText, user.role === 'admin' && styles.adminRoleText]}>
            {user.role}
          </Text>
        </View>
      </View>
    );
  }

  function renderChatItem({ item: chat }: { item: ChatAdminItem }) {
    return (
      <View style={styles.chatItem}>
        <View style={styles.chatItemInfo}>
          <View style={styles.chatUsersContainer}>
            <Text style={styles.chatUserName}>{chat.user1?.display_name || 'Unknown'}</Text>
            <Text style={styles.chatUserSeparator}> & </Text>
            <Text style={styles.chatUserName}>{chat.user2?.display_name || 'Unknown'}</Text>
          </View>
          <View style={styles.chatMeta}>
            <Text style={[styles.chatStatus, !chat.is_active && styles.chatStatusInactive]}>
              {chat.is_active ? 'Active' : 'Inactive'}
            </Text>
            {chat.unseen_count > 0 && (
              <View style={styles.unseenBadge}>
                <Text style={styles.unseenBadgeText}>{chat.unseen_count} unseen</Text>
              </View>
            )}
            <Text style={styles.chatDate}>
              {new Date(chat.last_message_at).toLocaleDateString()}
            </Text>
          </View>
        </View>
        <View style={styles.chatActions}>
          <TouchableOpacity
            style={styles.chatActionButton}
            onPress={() => openChatInvisible(chat.id)}
          >
            <EyeOff size={18} color="#0ea5e9" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.chatActionButton}
            onPress={() => viewArchive(chat.id)}
          >
            <Archive size={18} color="#f59e0b" />
          </TouchableOpacity>
          {chat.is_active && (
            <TouchableOpacity
              style={styles.chatActionButton}
              onPress={() => deactivateChat(chat.id)}
            >
              <Trash2 size={18} color="#ef4444" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  function renderAdminMessage({ item: msg }: { item: AdminMessage }) {
    return (
      <View style={[styles.archiveItem, msg.is_deleted_by_user && styles.archiveItemDeleted]}>
        <View style={styles.archiveHeader}>
          <Text style={styles.archiveSender}>{msg.sender_name}</Text>
          <View style={styles.archiveMetaRow}>
            {msg.is_deleted_by_user && (
              <View style={styles.deletedBadge}>
                <Text style={styles.deletedBadgeText}>DELETED BY USER</Text>
              </View>
            )}
            {msg.admin_seen_at ? (
              <Text style={styles.archiveSeen}>Seen {formatDate(msg.admin_seen_at)}</Text>
            ) : (
              <View style={styles.unseenIndicator}>
                <Eye size={12} color="#f59e0b" />
                <Text style={styles.unseenText}>Unseen</Text>
              </View>
            )}
          </View>
        </View>

        {msg.message_type === 'image' && msg.media_url && (
          <Image source={{ uri: msg.media_url }} style={styles.archiveImage} resizeMode="cover" />
        )}
        {msg.message_type === 'video' && (
          <View style={styles.archiveMediaPlaceholder}>
            <Play size={20} color="#94a3b8" />
            <Text style={styles.archiveMediaLabel}>Video</Text>
          </View>
        )}
        {msg.message_type === 'audio' && (
          <View style={styles.archiveMediaPlaceholder}>
            <Mic size={20} color="#94a3b8" />
            <Text style={styles.archiveMediaLabel}>Voice message</Text>
          </View>
        )}
        {msg.content && (
          <Text style={[styles.archiveContent, msg.is_deleted_by_user && styles.archiveContentDeleted]}>
            {msg.content}
          </Text>
        )}

        <View style={styles.archiveFooter}>
          <Text style={styles.archiveTime}>{formatDate(msg.created_at)}</Text>
          {msg.delete_after && (
            <View style={styles.deleteTimer}>
              <Clock size={12} color="#64748b" />
              <Text style={styles.deleteTimerText}>
                Deletes {new Date(msg.delete_after).toLocaleString()}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Shield size={24} color="#0ea5e9" />
        <Text style={styles.headerTitle}>Admin Panel</Text>
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'users' && styles.activeTab]}
          onPress={() => { setActiveTab('users'); setLoading(true); }}
        >
          <Users size={16} color={activeTab === 'users' ? '#0ea5e9' : '#64748b'} />
          <Text style={[styles.tabText, activeTab === 'users' && styles.activeTabText]}>Users</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'chats' && styles.activeTab]}
          onPress={() => { setActiveTab('chats'); setLoading(true); }}
        >
          <MessageSquare size={16} color={activeTab === 'chats' ? '#0ea5e9' : '#64748b'} />
          <Text style={[styles.tabText, activeTab === 'chats' && styles.activeTabText]}>Chats</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'archive' && styles.activeTab]}
          onPress={() => { setActiveTab('archive'); setLoading(true); setSelectedChatId(null); }}
        >
          <Archive size={16} color={activeTab === 'archive' ? '#0ea5e9' : '#64748b'} />
          <Text style={[styles.tabText, activeTab === 'archive' && styles.activeTabText]}>Archive</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'create' && styles.activeTab]}
          onPress={() => setActiveTab('create')}
        >
          <Plus size={16} color={activeTab === 'create' ? '#0ea5e9' : '#64748b'} />
          <Text style={[styles.tabText, activeTab === 'create' && styles.activeTabText]}>New</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'users' && (
        <>
          <View style={styles.searchContainer}>
            <Search size={18} color="#64748b" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search users..."
              placeholderTextColor="#64748b"
              value={searchUser}
              onChangeText={setSearchUser}
            />
          </View>
          {loading ? (
            <ActivityIndicator size="large" color="#0ea5e9" style={styles.loader} />
          ) : (
            <FlatList
              data={filteredUsers}
              renderItem={renderUserItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )}
        </>
      )}

      {activeTab === 'chats' && (
        <>
          {loading ? (
            <ActivityIndicator size="large" color="#0ea5e9" style={styles.loader} />
          ) : (
            <FlatList
              data={chats}
              renderItem={renderChatItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )}
        </>
      )}

      {activeTab === 'archive' && (
        <>
          {selectedChatId && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => { setSelectedChatId(null); setLoading(true); fetchAdminArchive(); }}
            >
              <Text style={styles.backButtonText}>All Messages</Text>
            </TouchableOpacity>
          )}
          {loading ? (
            <ActivityIndicator size="large" color="#0ea5e9" style={styles.loader} />
          ) : adminMessages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Archive size={48} color="#334155" />
              <Text style={styles.emptyText}>No archived messages</Text>
            </View>
          ) : (
            <FlatList
              data={adminMessages}
              renderItem={renderAdminMessage}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )}
        </>
      )}

      {activeTab === 'create' && (
        <View style={styles.createForm}>
          <Text style={styles.formTitle}>Create New Chat Pair</Text>
          <Text style={styles.formSubtitle}>
            Enter two usernames to pair. Max 20 active chats.
          </Text>
          <TextInput
            style={styles.formInput}
            placeholder="First username"
            placeholderTextColor="#64748b"
            value={newChatUser1}
            onChangeText={setNewChatUser1}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.formInput}
            placeholder="Second username"
            placeholderTextColor="#64748b"
            value={newChatUser2}
            onChangeText={setNewChatUser2}
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.createButton} onPress={createChat}>
            <UserPlus size={20} color="#fff" />
            <Text style={styles.createButtonText}>Create Chat</Text>
          </TouchableOpacity>
        </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 4,
    gap: 2,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#0f172a',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  activeTabText: {
    color: '#0ea5e9',
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
  separator: {
    height: 1,
    backgroundColor: '#1e293b',
  },
  loader: {
    marginTop: 40,
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
  // User item
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0ea5e9',
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f8fafc',
  },
  userUsername: {
    fontSize: 13,
    color: '#64748b',
  },
  roleBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  adminBadgeStyle: { backgroundColor: '#f59e0b20' },
  userBadgeStyle: { backgroundColor: '#0ea5e920' },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0ea5e9',
  },
  adminRoleText: { color: '#f59e0b' },
  // Chat item
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  chatItemInfo: {
    flex: 1,
  },
  chatUsersContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatUserName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f8fafc',
  },
  chatUserSeparator: {
    fontSize: 15,
    color: '#64748b',
    marginHorizontal: 6,
  },
  chatMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatStatus: {
    fontSize: 12,
    fontWeight: '600',
    color: '#22c55e',
  },
  chatStatusInactive: { color: '#64748b' },
  unseenBadge: {
    backgroundColor: '#f59e0b20',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  unseenBadgeText: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '600',
  },
  chatDate: {
    fontSize: 12,
    color: '#64748b',
  },
  chatActions: {
    flexDirection: 'row',
    gap: 4,
  },
  chatActionButton: {
    padding: 8,
  },
  // Archive
  backButton: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    color: '#0ea5e9',
    fontSize: 14,
    fontWeight: '600',
  },
  archiveItem: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    marginVertical: 4,
  },
  archiveItemDeleted: {
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
    opacity: 0.7,
  },
  archiveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  archiveSender: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f8fafc',
  },
  archiveMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deletedBadge: {
    backgroundColor: '#ef444420',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  deletedBadgeText: {
    color: '#ef4444',
    fontSize: 9,
    fontWeight: '700',
  },
  archiveSeen: {
    fontSize: 11,
    color: '#64748b',
  },
  unseenIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  unseenText: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '600',
  },
  archiveContent: {
    fontSize: 14,
    color: '#e2e8f0',
    lineHeight: 20,
  },
  archiveContentDeleted: {
    textDecorationLine: 'line-through',
    color: '#64748b',
  },
  archiveImage: {
    width: 150,
    height: 150,
    borderRadius: 8,
    marginBottom: 6,
  },
  archiveMediaPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  archiveMediaLabel: {
    color: '#94a3b8',
    fontSize: 13,
  },
  archiveFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  archiveTime: {
    fontSize: 11,
    color: '#64748b',
  },
  deleteTimer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deleteTimerText: {
    fontSize: 11,
    color: '#64748b',
  },
  // Create form
  createForm: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 16,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f8fafc',
  },
  formSubtitle: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 8,
  },
  formInput: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#f8fafc',
    borderWidth: 1,
    borderColor: '#334155',
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0ea5e9',
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 8,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
