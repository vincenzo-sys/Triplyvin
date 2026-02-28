import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import React from 'react'
import { renderToPng } from './infographics/renderer.js'
import { PricingComparison } from './infographics/templates/pricing-comparison.js'
import { StatHighlight } from './infographics/templates/stat-highlight.js'
import { TipsList } from './infographics/templates/tips-list.js'
import { ComparisonMatrix } from './infographics/templates/comparison-matrix.js'
import { ProcessStrip } from './infographics/templates/process-strip.js'
import { extractInfographicData } from './infographics/extract.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(__dirname, '..', 'test-output')

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true })
}

async function testPricingComparison() {
  console.log('Rendering pricing comparison...')
  const jsx = React.createElement(PricingComparison, {
    title: 'JFK Airport Parking Rates',
    airportCode: 'JFK',
    rows: [
      { name: 'The Parking Spot JFK', price: '$14.95/day', features: ['Shuttle', 'Covered'] },
      { name: 'JFK Long Term Lot', price: '$18.00/day', features: ['On-Airport', 'Outdoor'] },
      { name: 'PreFlight Parking', price: '$12.99/day', features: ['Shuttle', 'EV Charging'] },
      { name: 'Fast Track JFK', price: '$16.50/day', features: ['Valet', '24/7'] },
      { name: 'Park Ride Fly JFK', price: '$11.99/day', features: ['Self-Park', 'Outdoor'] },
    ],
  })
  const buffer = await renderToPng({ width: 1200, height: 675, jsx })
  const filePath = path.join(outDir, 'pricing-comparison.png')
  fs.writeFileSync(filePath, buffer)
  console.log(`  Saved: ${filePath} (${(buffer.length / 1024).toFixed(1)} KB)`)
}

async function testStatHighlight() {
  console.log('Rendering stat highlight...')
  const jsx = React.createElement(StatHighlight, {
    stat: '45%',
    label: 'Average Savings vs On-Airport',
    context: 'Off-airport parking lots near JFK can save travelers up to 45% compared to the official on-airport long-term parking rates.',
  })
  const buffer = await renderToPng({ width: 1200, height: 400, jsx })
  const filePath = path.join(outDir, 'stat-highlight.png')
  fs.writeFileSync(filePath, buffer)
  console.log(`  Saved: ${filePath} (${(buffer.length / 1024).toFixed(1)} KB)`)
}

async function testTipsList() {
  console.log('Rendering tips list...')
  const jsx = React.createElement(TipsList, {
    title: 'JFK Parking Tips for First-Timers',
    tips: [
      'Book at least 48 hours in advance for the best rates',
      'Compare shuttle wait times — some lots run every 5 minutes',
      'Check if your lot offers EV charging if you drive electric',
      'Look for covered parking if traveling during winter months',
      'Download the lot\'s app for faster check-in and check-out',
      'Ask about loyalty programs — most lots offer a free day after 10 visits',
    ],
  })
  const buffer = await renderToPng({ width: 1200, height: 675, jsx })
  const filePath = path.join(outDir, 'tips-list.png')
  fs.writeFileSync(filePath, buffer)
  console.log(`  Saved: ${filePath} (${(buffer.length / 1024).toFixed(1)} KB)`)
}

async function testComparisonMatrix() {
  console.log('Rendering comparison matrix...')
  const jsx = React.createElement(ComparisonMatrix, {
    title: 'JFK Parking Feature Comparison',
    airportCode: 'JFK',
    lots: ['The Parking Spot', 'PreFlight', 'Fast Track', 'Park Ride Fly'],
    features: [
      { name: 'Shuttle Service', values: { 'The Parking Spot': true, 'PreFlight': true, 'Fast Track': true, 'Park Ride Fly': true } },
      { name: 'Covered Parking', values: { 'The Parking Spot': true, 'PreFlight': false, 'Fast Track': true, 'Park Ride Fly': false } },
      { name: 'Valet Option', values: { 'The Parking Spot': false, 'PreFlight': false, 'Fast Track': true, 'Park Ride Fly': false } },
      { name: 'EV Charging', values: { 'The Parking Spot': true, 'PreFlight': true, 'Fast Track': false, 'Park Ride Fly': false } },
      { name: '24/7 Security', values: { 'The Parking Spot': true, 'PreFlight': true, 'Fast Track': true, 'Park Ride Fly': true } },
      { name: 'Indoor Garage', values: { 'The Parking Spot': true, 'PreFlight': false, 'Fast Track': true, 'Park Ride Fly': false } },
    ],
  })
  const buffer = await renderToPng({ width: 1200, height: 675, jsx })
  const filePath = path.join(outDir, 'comparison-matrix.png')
  fs.writeFileSync(filePath, buffer)
  console.log(`  Saved: ${filePath} (${(buffer.length / 1024).toFixed(1)} KB)`)
}

async function testProcessStrip() {
  console.log('Rendering process strip...')
  const jsx = React.createElement(ProcessStrip, {
    title: 'How Airport Parking Works',
    steps: [
      { label: 'Book Online', description: 'Reserve your spot in advance for the best rates' },
      { label: 'Drive to Lot', description: 'Follow GPS directions to your chosen parking facility' },
      { label: 'Shuttle to Terminal', description: 'Take the free shuttle to your departure terminal' },
      { label: 'Fly!', description: 'Your car stays safe and secure while you travel' },
    ],
  })
  const buffer = await renderToPng({ width: 1200, height: 400, jsx })
  const filePath = path.join(outDir, 'process-strip.png')
  fs.writeFileSync(filePath, buffer)
  console.log(`  Saved: ${filePath} (${(buffer.length / 1024).toFixed(1)} KB)`)
}

async function testExtraction() {
  console.log('\nTesting HTML extraction...')
  const sampleHtml = `
    <h2>JFK Parking Prices and Options</h2>
    <p>Here's what you can expect to pay at JFK parking lots:</p>
    <ul>
      <li>The Parking Spot JFK - $14.95/day with free shuttle service</li>
      <li>JFK Long Term Lot - $18.00/day, on-airport convenience</li>
      <li>PreFlight Parking - $12.99/day including EV charging</li>
    </ul>
    <p>You can save 45% by choosing off-airport parking over the official terminal lots.</p>
    <h2>Essential Tips for JFK Parking</h2>
    <p>Follow these tips to get the best deal:</p>
    <ul>
      <li>Book online at least 48 hours in advance for discounted rates</li>
      <li>Compare shuttle frequency — some lots offer pickups every 5 minutes</li>
      <li>Check if the lot offers covered parking during winter months</li>
      <li>Look for lots with EV charging stations if you drive electric</li>
      <li>Sign up for loyalty programs to earn free parking days</li>
    </ul>
  `

  const specs = extractInfographicData(sampleHtml, 'JFK', 'hub')
  console.log(`  Extracted ${specs.length} infographic spec(s):`)
  for (const spec of specs) {
    console.log(`    - ${spec.type} (insert after: "${spec.insertAfterHeading}")`)
    if (spec.type === 'pricing-comparison') {
      console.log(`      Rows: ${spec.data.rows.length}`)
    } else if (spec.type === 'tips-list') {
      console.log(`      Tips: ${spec.data.tips.length}`)
    } else if (spec.type === 'stat-highlight') {
      console.log(`      Stat: ${spec.data.stat} — ${spec.data.label}`)
    } else if (spec.type === 'comparison-matrix') {
      console.log(`      Lots: ${spec.data.lots.length}, Features: ${spec.data.features.length}`)
    } else if (spec.type === 'process-strip') {
      console.log(`      Steps: ${spec.data.steps.length}`)
    }
  }
}

async function testComparisonExtraction() {
  console.log('\nTesting comparison matrix extraction...')
  const comparisonHtml = `
    <h2>Compare JFK Parking Options</h2>
    <table>
      <tr><th>Feature</th><th>The Parking Spot</th><th>PreFlight Parking</th><th>Fast Track JFK</th></tr>
      <tr><td>Shuttle Service</td><td>Yes</td><td>Yes</td><td>Yes</td></tr>
      <tr><td>Covered Parking</td><td>Yes</td><td>No</td><td>Yes</td></tr>
      <tr><td>EV Charging</td><td>Yes</td><td>Yes</td><td>No</td></tr>
      <tr><td>Valet</td><td>No</td><td>No</td><td>Yes</td></tr>
      <tr><td>24/7 Security</td><td>Yes</td><td>Yes</td><td>Yes</td></tr>
    </table>
  `

  const specs = extractInfographicData(comparisonHtml, 'JFK', 'comparison')
  console.log(`  Extracted ${specs.length} spec(s) from comparison HTML:`)
  for (const spec of specs) {
    console.log(`    - ${spec.type}`)
    if (spec.type === 'comparison-matrix') {
      console.log(`      Lots: ${spec.data.lots.join(', ')}`)
      console.log(`      Features: ${spec.data.features.map(f => f.name).join(', ')}`)
    }
  }
}

async function testProcessExtraction() {
  console.log('\nTesting process strip extraction...')
  const processHtml = `
    <h2>How to Book Airport Parking at JFK</h2>
    <p>Follow these simple steps to secure your parking spot:</p>
    <ol>
      <li>Compare prices online at triplypro.com to find the best deal</li>
      <li>Select your dates and reserve your spot with a small deposit</li>
      <li>Drive to the lot on departure day and take the free shuttle</li>
      <li>When you return, call for pickup and retrieve your vehicle</li>
    </ol>
    <p>Book online and take the shuttle to your terminal for a stress-free experience.</p>
  `

  const specs = extractInfographicData(processHtml, 'JFK', 'sub-pillar')
  console.log(`  Extracted ${specs.length} spec(s) from process HTML:`)
  for (const spec of specs) {
    console.log(`    - ${spec.type}`)
    if (spec.type === 'process-strip') {
      for (const step of spec.data.steps) {
        console.log(`      ${step.label}: ${step.description}`)
      }
    }
  }
}

async function main() {
  console.log('=== Infographic Generator Test ===\n')

  await testPricingComparison()
  await testStatHighlight()
  await testTipsList()
  await testComparisonMatrix()
  await testProcessStrip()
  await testExtraction()
  await testComparisonExtraction()
  await testProcessExtraction()

  console.log(`\nAll tests complete! Check ${outDir} for output PNGs.`)
}

main().catch(console.error)
