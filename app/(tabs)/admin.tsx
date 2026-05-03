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
  UserPlus,
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
}

export default function AdminScreen() {
  const [activeTab, setActiveTab] = useState<'users' | 'chats' | 'create'>('users');
  const [users, setUsers] = useState<ProfileItem[]>([]);
  const [chats, setChats] = useState<ChatAdminItem[]>([]);
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

        return {
          ...chat,
          user1: u1 as ChatAdminItem['user1'],
          user2: u2 as ChatAdminItem['user2'],
        };
      })
    );

    setChats(chatItems);
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

  const filteredUsers = users.filter(
    (u) =>
      !searchUser ||
      u.username.toLowerCase().includes(searchUser.toLowerCase()) ||
      u.display_name.toLowerCase().includes(searchUser.toLowerCase())
  );

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
        <TouchableOpacity
          style={styles.chatItemInfo}
          onPress={() => router.push(`/chat/${chat.id}`)}
        >
          <View style={styles.chatUsersContainer}>
            <Text style={styles.chatUserName}>{chat.user1?.display_name || 'Unknown'}</Text>
            <Text style={styles.chatUserSeparator}> & </Text>
            <Text style={styles.chatUserName}>{chat.user2?.display_name || 'Unknown'}</Text>
          </View>
          <View style={styles.chatMeta}>
            <Text style={[styles.chatStatus, !chat.is_active && styles.chatStatusInactive]}>
              {chat.is_active ? 'Active' : 'Inactive'}
            </Text>
            <Text style={styles.chatDate}>
              {new Date(chat.last_message_at).toLocaleDateString()}
            </Text>
          </View>
        </TouchableOpacity>
        <View style={styles.chatActions}>
          <TouchableOpacity
            style={styles.chatActionButton}
            onPress={() => router.push(`/chat/${chat.id}`)}
          >
            <Eye size={18} color="#0ea5e9" />
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Shield size={24} color="#0ea5e9" />
        <Text style={styles.headerTitle}>Admin Panel</Text>
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'users' && styles.activeTab]}
          onPress={() => {
            setActiveTab('users');
            setLoading(true);
          }}
        >
          <Users size={16} color={activeTab === 'users' ? '#0ea5e9' : '#64748b'} />
          <Text style={[styles.tabText, activeTab === 'users' && styles.activeTabText]}>
            Users
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'chats' && styles.activeTab]}
          onPress={() => {
            setActiveTab('chats');
            setLoading(true);
          }}
        >
          <MessageSquare size={16} color={activeTab === 'chats' ? '#0ea5e9' : '#64748b'} />
          <Text style={[styles.tabText, activeTab === 'chats' && styles.activeTabText]}>
            Chats
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'create' && styles.activeTab]}
          onPress={() => setActiveTab('create')}
        >
          <Plus size={16} color={activeTab === 'create' ? '#0ea5e9' : '#64748b'} />
          <Text style={[styles.tabText, activeTab === 'create' && styles.activeTabText]}>
            New Chat
          </Text>
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
    gap: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#0f172a',
  },
  tabText: {
    fontSize: 13,
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
  adminBadgeStyle: {
    backgroundColor: '#f59e0b20',
  },
  userBadgeStyle: {
    backgroundColor: '#0ea5e920',
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0ea5e9',
  },
  adminRoleText: {
    color: '#f59e0b',
  },
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
  chatStatusInactive: {
    color: '#64748b',
  },
  chatDate: {
    fontSize: 12,
    color: '#64748b',
  },
  chatActions: {
    flexDirection: 'row',
    gap: 8,
  },
  chatActionButton: {
    padding: 8,
  },
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
