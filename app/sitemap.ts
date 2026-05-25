import { MetadataRoute } from 'next'
import { getAllPosts } from '@/lib/mdx'
import { getAllLoungePosts } from '@/lib/lounge'

export default function sitemap(): MetadataRoute.Sitemap {
  const today = new Date()
  today.setHours(23, 59, 59, 999)

  const postUrls = getAllPosts()
    .filter((post) => new Date(post.date) <= today)
    .map((post) => ({
      url:             `https://bigsolevibes.com/sole-report/${post.slug}`,
      lastModified:    new Date(post.date),
      changeFrequency: 'monthly' as const,
      priority:        0.6,
    }))

  const loungeUrls = getAllLoungePosts()
    .filter((post) => new Date(post.date) <= today)
    .map((post) => ({
      url:             `https://bigsolevibes.com/the-lounge/${post.slug}`,
      lastModified:    new Date(post.date),
      changeFrequency: 'monthly' as const,
      priority:        0.8,
    }))

  return [
    {
      url:             'https://bigsolevibes.com',
      lastModified:    new Date(),
      changeFrequency: 'weekly',
      priority:        1,
    },
    {
      url:             'https://bigsolevibes.com/shop',
      lastModified:    new Date(),
      changeFrequency: 'weekly',
      priority:        0.8,
    },
    {
      url:             'https://bigsolevibes.com/the-lounge',
      lastModified:    new Date(),
      changeFrequency: 'daily',
      priority:        0.9,
    },
    ...loungeUrls,
    ...postUrls,
  ]
}
