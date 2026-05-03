import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useAuth } from '@/context/auth';
import { LogOut, User, Shield } from 'lucide-react-native';

export default function SettingsScreen() {
  const { profile, signOut, user } = useAuth();

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: signOut,
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <View style={styles.profileCard}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {profile?.display_name?.charAt(0)?.toUpperCase() || '?'}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{profile?.display_name}</Text>
            <Text style={styles.profileUsername}>@{profile?.username}</Text>
          </View>
        </View>
        <View
          style={[
            styles.roleBadge,
            profile?.role === 'admin' ? styles.adminBadgeBg : styles.userBadgeBg,
          ]}
        >
          {profile?.role === 'admin' ? (
            <Shield size={12} color="#f59e0b" />
          ) : (
            <User size={12} color="#0ea5e9" />
          )}
          <Text
            style={[
              styles.roleText,
              profile?.role === 'admin' ? styles.adminRoleText : styles.userRoleText,
            ]}
          >
            {profile?.role?.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.menuItem}>
          <Text style={styles.menuItemText}>User ID</Text>
          <Text style={styles.menuItemValue}>{profile?.username}</Text>
        </View>
        <View style={styles.menuDivider} />
        <View style={styles.menuItem}>
          <Text style={styles.menuItemText}>Email</Text>
          <Text style={styles.menuItemValue}>{user?.email}</Text>
        </View>
        <View style={styles.menuDivider} />
        <View style={styles.menuItem}>
          <Text style={styles.menuItemText}>Member since</Text>
          <Text style={styles.menuItemValue}>
            {profile?.created_at
              ? new Date(profile.created_at).toLocaleDateString()
              : 'N/A'}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <LogOut size={20} color="#ef4444" />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
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
  profileCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 20,
    marginBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0ea5e9',
  },
  profileInfo: {
    gap: 2,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#f8fafc',
  },
  profileUsername: {
    fontSize: 14,
    color: '#64748b',
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  adminBadgeBg: {
    backgroundColor: '#f59e0b20',
  },
  userBadgeBg: {
    backgroundColor: '#0ea5e920',
  },
  roleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  adminRoleText: {
    color: '#f59e0b',
  },
  userRoleText: {
    color: '#0ea5e9',
  },
  section: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    marginHorizontal: 20,
    padding: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
    paddingHorizontal: 16,
    paddingVertical: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuItemText: {
    fontSize: 15,
    color: '#f8fafc',
  },
  menuItemValue: {
    fontSize: 14,
    color: '#64748b',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginHorizontal: 16,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    marginHorizontal: 20,
    marginTop: 24,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#ef444430',
  },
  signOutText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
  },
});
