import React from 'react'

const BRAND = {
  navy: '#1a2b4a',
  coral: '#ff6b6b',
  white: '#ffffff',
  gray50: '#f9fafb',
  gray200: '#e5e7eb',
  gray700: '#374151',
}

export interface ComparisonFeature {
  name: string
  values: Record<string, boolean>
}

export interface ComparisonMatrixProps {
  title: string
  lots: string[]
  features: ComparisonFeature[]
  airportCode: string
}

export function ComparisonMatrix({ title, lots, features, airportCode }: ComparisonMatrixProps) {
  const displayLots = lots.slice(0, 5)
  const displayFeatures = features.slice(0, 8)
  const colWidth = `${Math.floor(70 / displayLots.length)}%`

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: BRAND.white,
        fontFamily: 'Inter',
        padding: '48px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: '28px',
              fontWeight: 700,
              color: BRAND.navy,
              lineHeight: 1.2,
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: '16px',
              color: BRAND.gray700,
              marginTop: '4px',
            }}
          >
            {`${airportCode} Airport Parking`}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            backgroundColor: BRAND.navy,
            color: BRAND.white,
            fontSize: '14px',
            fontWeight: 700,
            padding: '8px 16px',
            borderRadius: '8px',
          }}
        >
          triplypro.com
        </div>
      </div>

      {/* Table */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          borderRadius: '12px',
          overflow: 'hidden',
          border: `1px solid ${BRAND.gray200}`,
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: 'flex',
            backgroundColor: BRAND.navy,
            padding: '14px 20px',
          }}
        >
          <div
            style={{
              display: 'flex',
              width: '30%',
              fontSize: '14px',
              fontWeight: 700,
              color: BRAND.white,
              opacity: 0.7,
            }}
          >
            Feature
          </div>
          {displayLots.map((lot, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                width: colWidth,
                fontSize: '14px',
                fontWeight: 700,
                color: BRAND.white,
                justifyContent: 'center',
              }}
            >
              {lot}
            </div>
          ))}
        </div>

        {/* Feature rows */}
        {displayFeatures.map((feature, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: i % 2 === 0 ? BRAND.gray50 : BRAND.white,
              padding: '12px 20px',
            }}
          >
            <div
              style={{
                display: 'flex',
                width: '30%',
                fontSize: '15px',
                fontWeight: 600,
                color: BRAND.navy,
              }}
            >
              {feature.name}
            </div>
            {displayLots.map((lot, j) => (
              <div
                key={j}
                style={{
                  display: 'flex',
                  width: colWidth,
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 700,
                  color: feature.values[lot] ? BRAND.coral : BRAND.gray200,
                }}
              >
                {feature.values[lot] ? 'YES' : '-'}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          marginTop: '12px',
          fontSize: '13px',
          color: BRAND.gray700,
        }}
      >
        Compare features and book at triplypro.com
      </div>
    </div>
  )
}
