import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Alert,
  TextInput,
  Dimensions,
  StatusBar,
  SafeAreaView,
  ActivityIndicator,
  Image,
  Animated,
  PanResponder,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import baseApi from './baseApi';
const { width } = Dimensions.get('window');
const STORAGE_KEY = '@news_articles';
const BOOKMARKS_KEY = '@bookmarks';
const LIKED_KEY = '@liked_articles';

// NewsAPI URL
// const NEWS_API_URL = 'https://newsapi.org/v2/top-headlines?country=us&apiKey=d6474139bc3f413db95a9808562c6de2';

// Skeleton Loader Component
const SkeletonLoader = () => (
  <View style={styles.skeletonContainer}>
    {[...Array(3)].map((_, index) => (
      <View key={index} style={styles.skeletonItem}>
        <View style={styles.skeletonImage} />
        <View style={styles.skeletonTextContainer}>
          <View style={styles.skeletonTitle} />
          <View style={styles.skeletonSubtitle} />
        </View>
      </View>
    ))}
  </View>
);

// Swipeable Article Item Component
const SwipeableArticleItem = ({ article, onLike, onBookmark, isLiked, isBookmarked }) => {
  const pan = new Animated.ValueXY();
  const [showActions, setShowActions] = useState(false);

  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gestureState) => {
      return Math.abs(gestureState.dx) > 20;
    },
    onPanResponderMove: (evt, gestureState) => {
      pan.setValue({ x: gestureState.dx, y: 0 });
      setShowActions(Math.abs(gestureState.dx) > 50);
    },
    onPanResponderRelease: (evt, gestureState) => {
      if (gestureState.dx > 100) {
        onLike(article);
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: false,
        }).start();
      } else if (gestureState.dx < -100) {
        onBookmark(article);
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: false,
        }).start();
      } else {
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: false,
        }).start();
      }
      setShowActions(false);
    },
  });

  return (
    <View style={styles.swipeContainer}>
      {showActions && (
        <View style={styles.actionsContainer}>
          <View style={styles.likeAction}>
            <Ionicons name="heart" size={24} color="#fff" />
            <Text style={styles.actionText}>Like</Text>
          </View>
          <View style={styles.bookmarkAction}>
            <Ionicons name="bookmark" size={24} color="#fff" />
            <Text style={styles.actionText}>Bookmark</Text>
          </View>
        </View>
      )}
      <Animated.View
        style={[
          styles.articleItem,
          {
            transform: [{ translateX: pan.x }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <Image
          source={{
            uri: article.urlToImage || 'https://via.placeholder.com/400x200',
          }}
          style={styles.articleImage}
          defaultSource={{ uri: 'https://via.placeholder.com/400x200' }}
        />
        <View style={styles.articleContent}>
          <Text style={styles.articleTitle} numberOfLines={2}>
            {article.title || 'No title available'}
          </Text>
          <Text style={styles.articleBody} numberOfLines={3}>
            {article.description || 'No description available'}
          </Text>
          <View style={styles.articleFooter}>
            <Text style={styles.articleDate}>
              {article.publishedAt
                ? new Date(article.publishedAt).toLocaleDateString()
                : 'Unknown date'}
            </Text>
            <View style={styles.actionButtons}>
              <TouchableOpacity
                onPress={() => onLike(article)}
                style={[styles.actionButton, isLiked && styles.activeAction]}
                accessibilityLabel={isLiked ? 'Unlike article' : 'Like article'}
                accessibilityRole="button"
              >
                <Ionicons
                  name={isLiked ? 'heart' : 'heart-outline'}
                  size={20}
                  color={isLiked ? '#e74c3c' : '#666'}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onBookmark(article)}
                style={[styles.actionButton, isBookmarked && styles.activeAction]}
                accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Bookmark article'}
                accessibilityRole="button"
              >
                <Ionicons
                  name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
                  size={20}
                  color={isBookmarked ? '#3498db' : '#666'}
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Animated.View>
    </View>
  );
};

export default function App() {
  const [articles, setArticles] = useState([]);
  const [filteredArticles, setFilteredArticles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [likedArticles, setLikedArticles] = useState(new Set());
  const [bookmarkedArticles, setBookmarkedArticles] = useState(new Set());
  const [error, setError] = useState(null);

  // Check network connectivity
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected);
      if (state.isConnected && articles.length === 0) {
        fetchArticles(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // Load cached data and user preferences
  useEffect(() => {
    loadCachedData();
    loadUserPreferences();
  }, []);

  // Filter articles based on search query
  useEffect(() => {
    if (searchQuery.trim()) {
      const filtered = articles.filter(
        article =>
          (article.title && article.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (article.description && article.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
      setFilteredArticles(filtered);
    } else {
      setFilteredArticles(articles);
    }
  }, [searchQuery, articles]);

  const loadCachedData = async () => {
    try {
      const cachedArticles = await AsyncStorage.getItem(STORAGE_KEY);
      if (cachedArticles) {
        const parsedArticles = JSON.parse(cachedArticles);
        setArticles(parsedArticles);
        setFilteredArticles(parsedArticles);
      } else if (!isOnline) {
        setError('No internet connection and no cached articles available');
      }
    } catch (error) {
      console.error('Error loading cached data:', error);
      setError('Failed to load cached articles');
    }
  };

  const loadUserPreferences = async () => {
    try {
      const [liked, bookmarked] = await Promise.all([
        AsyncStorage.getItem(LIKED_KEY),
        AsyncStorage.getItem(BOOKMARKS_KEY),
      ]);
      if (liked) setLikedArticles(new Set(JSON.parse(liked)));
      if (bookmarked) setBookmarkedArticles(new Set(JSON.parse(bookmarked)));
    } catch (error) {
      console.error('Error loading user preferences:', error);
    }
  };

  const fetchArticles = async (isRefresh = false) => {
    if (!isOnline && !isRefresh) {
      Alert.alert('Offline', 'You are currently offline. Showing cached articles.');
      return;
    }

    if (loading || (!hasMore && !isRefresh)) return;

    setLoading(true);
    setError(null);

    try {
      const currentPage = isRefresh ? 1 : page;
      const response = await fetch(`${baseApi}&page=${currentPage}&pageSize=10`);
      if (!response.ok) {
        throw new Error('Failed to fetch articles');
      }

      const data = await response.json();
      if (data.status !== 'ok') {
        throw new Error('API error: ' + data.message);
      }

      const newArticles = data.articles.map(article => ({
        id: article.url, // Use URL as unique ID since NewsAPI doesn't provide a numeric ID
        title: article.title || 'No title',
        description: article.description || 'No description',
        urlToImage: article.urlToImage || null,
        publishedAt: article.publishedAt || null,
        source: article.source.name,
        content: article.content || '',
      }));

      if (newArticles.length === 0 || data.totalResults <= articles.length) {
        setHasMore(false);
      } else {
        const updatedArticles = isRefresh
          ? newArticles
          : [...articles, ...newArticles];
        setArticles(updatedArticles);
        setFilteredArticles(updatedArticles);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedArticles));
        if (!isRefresh) {
          setPage(currentPage + 1);
        } else {
          setPage(2);
          setHasMore(true);
        }
      }
    } catch (error) {
      console.error('Error fetching articles:', error);
      setError('Failed to fetch articles. Please try again.');
      if (articles.length === 0) {
        loadCachedData();
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchArticles(true);
  }, []);

  const loadMore = useCallback(() => {
    if (hasMore && !loading && isOnline) {
      fetchArticles();
    }
  }, [hasMore, loading, isOnline, page]);

  const handleLike = useCallback(
    async article => {
      const newLikedArticles = new Set(likedArticles);
      if (newLikedArticles.has(article.id)) {
        newLikedArticles.delete(article.id);
      } else {
        newLikedArticles.add(article.id);
      }
      setLikedArticles(newLikedArticles);
      try {
        await AsyncStorage.setItem(LIKED_KEY, JSON.stringify([...newLikedArticles]));
      } catch (error) {
        console.error('Error saving liked articles:', error);
      }
    },
    [likedArticles]
  );

  const handleBookmark = useCallback(
    async article => {
      const newBookmarkedArticles = new Set(bookmarkedArticles);
      if (newBookmarkedArticles.has(article.id)) {
        newBookmarkedArticles.delete(article.id);
      } else {
        newBookmarkedArticles.add(article.id);
      }
      setBookmarkedArticles(newBookmarkedArticles);
      try {
        await AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...newBookmarkedArticles]));
      } catch (error) {
        console.error('Error saving bookmarked articles:', error);
      }
    },
    [bookmarkedArticles]
  );

  const renderArticle = ({ item }) => (
    <SwipeableArticleItem
      article={item}
      onLike={handleLike}
      onBookmark={handleBookmark}
      isLiked={likedArticles.has(item.id)}
      isBookmarked={bookmarkedArticles.has(item.id)}
    />
  );

  const renderFooter = () => {
    if (!loading) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#3498db" />
        <Text style={styles.loadingText}>Loading more articles...</Text>
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading && articles.length === 0) {
      return <SkeletonLoader />;
    }
    if (error) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="warning-outline" size={64} color="#e74c3c" />
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => fetchArticles(true)}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="newspaper-outline" size={64} color="#bdc3c7" />
        <Text style={styles.emptyText}>No articles found</Text>
      </View>
    );
  };

  // Initial fetch
  useEffect(() => {
    if (isOnline && articles.length === 0) {
      fetchArticles(true);
    }
  }, [isOnline]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Smart News Feed</Text>
        <View style={styles.connectionStatus}>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? '#2ecc71' : '#e74c3c' }]} />
          <Text style={styles.statusText}>{isOnline ? 'Online' : 'Offline'}</Text>
        </View>
      </View>
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search articles..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          accessibilityLabel="Search articles"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={20} color="#666" />
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={filteredArticles}
        renderItem={renderArticle}
        keyExtractor={item => item.id}
        onEndReached={loadMore}
        onEndReachedThreshold={0.1}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#3498db']}
            tintColor="#3498db"
          />
        }
        ListFooterComponent={renderFooter}
        ListEmptyComponent={renderEmpty}
        showsVerticalScrollIndicator={false}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={10}
        removeClippedSubviews={true}
      />
      {filteredArticles.length > 0 && (
        <View style={styles.swipeInstructions}>
          <Text style={styles.instructionText}>💡 Swipe right to like, left to bookmark</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#2c3e50',
  },
  swipeContainer: {
    position: 'relative',
  },
  actionsContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    zIndex: 1,
  },
  likeAction: {
    flex: 1,
    backgroundColor: '#e74c3c',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bookmarkAction: {
    flex: 1,
    backgroundColor: '#3498db',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionText: {
    color: '#fff',
    fontWeight: 'bold',
    marginTop: 4,
  },
  articleItem: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  articleImage: {
    width: '100%',
    height: 200,
    backgroundColor: '#e9ecef',
  },
  articleContent: {
    padding: 16,
  },
  articleTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 8,
    lineHeight: 24,
  },
  articleBody: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 12,
  },
  articleFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  articleDate: {
    fontSize: 12,
    color: '#95a5a6',
  },
  actionButtons: {
    flexDirection: 'row',
  },
  actionButton: {
    padding: 8,
    marginLeft: 8,
    borderRadius: 20,
  },
  activeAction: {
    backgroundColor: '#f8f9fa',
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    color: '#666',
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 64,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#3498db',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  swipeInstructions: {
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#e9ecef',
  },
  instructionText: {
    textAlign: 'center',
    fontSize: 12,
    color: '#666',
  },
  skeletonContainer: {
    padding: 16,
  },
  skeletonItem: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  skeletonImage: {
    width: 80,
    height: 80,
    backgroundColor: '#e9ecef',
    borderRadius: 8,
  },
  skeletonTextContainer: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'center',
  },
  skeletonTitle: {
    height: 16,
    backgroundColor: '#e9ecef',
    borderRadius: 4,
    marginBottom: 8,
  },
  skeletonSubtitle: {
    height: 12,
    backgroundColor: '#e9ecef',
    borderRadius: 4,
    width: '80%',
  },
});