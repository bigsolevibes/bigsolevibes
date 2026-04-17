import Navbar from '@/components/Navbar'
import Hero from '@/components/Hero'
import WhyBigSoleVibes from '@/components/WhyBigSoleVibes'
import ProductShowcase from '@/components/ProductShowcase'
import BlogPreview from '@/components/BlogPreview'
import EmailCapture from '@/components/EmailCapture'
import AdPlaceholder from '@/components/AdPlaceholder'
import Footer from '@/components/Footer'

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <WhyBigSoleVibes />
        <ProductShowcase />
        <BlogPreview />
        <EmailCapture />
        <AdPlaceholder />
      </main>
      <Footer />
    </>
  )
}
