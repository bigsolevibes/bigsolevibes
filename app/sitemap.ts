import { MetadataRoute } from 'next'
import { getAllPosts } from '@/lib/mdx'

export default function sitemap(): MetadataRoute.Sitemap {
  const blogUrls = getAllPosts().map((post) => ({
    url: `https://bigsolevibes.com/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }))

  return [
    {
      url: 'https://bigsolevibes.com',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://bigsolevibes.com/products',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: 'https://bigsolevibes.com/blog',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    ...blogUrls,
  ]
}
