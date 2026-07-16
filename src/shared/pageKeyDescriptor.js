import {
  eventToPageKeyDescriptor as eventToPolicyPageKeyDescriptor,
  formatAccelerator,
  normalizePageKeyDescriptor as normalizePolicyPageKeyDescriptor
} from './platformPolicy.js'

export function normalizePageKeyDescriptor(value, policy) {
  return normalizePolicyPageKeyDescriptor(value, policy)
}

export function eventToPageKeyDescriptor(event, policy) {
  return eventToPolicyPageKeyDescriptor(event, policy)
}

export function eventMatchesPageKeyDescriptor(event, descriptor, policy) {
  const result = eventToPageKeyDescriptor(event, policy)
  return Boolean(result?.ok && result.value === descriptor)
}

export function displayKeyDescriptor(value, policy) {
  return formatAccelerator(value, policy)
}
